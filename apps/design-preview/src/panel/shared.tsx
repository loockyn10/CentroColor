import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Badge, Button, Sheet, StatusBadge, useToast } from '../ui';
import {
  BANK_ALIAS,
  JOB_FLOW,
  STATUS_META,
  ars,
  dueLabel,
  jobBalance,
  jobCopies,
  jobIsLate,
  jobIsPaid,
  plural,
  type Job,
  type JobStatus,
} from '../data';

export function useMedia(query: string) {
  const get = () =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false;
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

export function PageHead({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="frame-tag">{eyebrow}</div>}
        <h1>{title}</h1>
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

// ───────── Banderas de prioridad (texto + ícono + canto de color) ─────────

export type Flag = 'late' | 'urgent' | 'pay' | 'ready' | undefined;
export function jobFlag(j: Job): Flag {
  if (jobIsLate(j)) return 'late';
  if (j.urgent && j.status !== 'delivered') return 'urgent';
  if (j.status === 'awaiting_payment') return 'pay';
  if (j.status === 'ready') return 'ready';
  return undefined;
}

/** Etiqueta de alerta (solo si hay algo que atender): Atrasado > Urgente. */
export function jobAlert(job: Job): 'Atrasado' | 'Urgente' | null {
  if (jobIsLate(job)) return 'Atrasado';
  if (job.urgent && job.status !== 'delivered') return 'Urgente';
  return null;
}

/** Estado en la ficha: el estado principal + alertas. El origen va como texto aparte. */
export function JobFlags({ job }: { job: Job }) {
  return (
    <span
      className="flags"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
    >
      <StatusBadge status={job.status} />
      {job.urgent && job.status !== 'delivered' && (
        <Badge tone="red" icon="bolt">
          Urgente
        </Badge>
      )}
      {jobIsLate(job) && (
        <Badge tone="red-soft" icon="clock">
          Atrasado
        </Badge>
      )}
    </span>
  );
}

/** «URGENTE · EN PROCESO»: alerta en rojo (si hay) + un único estado principal. */
export function StateLine({ job }: { job: Job }) {
  const alert = jobAlert(job);
  const m = STATUS_META[job.status];
  return (
    <span className="state">
      {alert && (
        <>
          <span className="hot">
            <Icon name={alert === 'Atrasado' ? 'clock' : 'bolt'} />
            {alert}
          </span>
          <span className="sep" aria-hidden="true">
            ·
          </span>
        </>
      )}
      <span className="st" data-tone={m.tone}>
        {job.status === 'awaiting_payment' && <Icon name="lock" />}
        {m.internal}
      </span>
    </span>
  );
}

/** Saldo pendiente como texto (solo si corresponde y el estado no lo dice ya). */
export function PayNote({ job, lead }: { job: Job; lead?: boolean }) {
  if (job.status === 'awaiting_payment' || job.status === 'delivered')
    return null;
  const b = jobBalance(job);
  return b > 0 ? (
    <span className="txt-warn">
      {lead && ' · '}Saldo {ars(b)}
    </span>
  ) : null;
}

// ───────── Tarjeta de trabajo (tablero) ─────────

export function JobCard({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const alert = jobAlert(job);
  return (
    <button
      type="button"
      className="jcard"
      data-flag={jobFlag(job)}
      onClick={onOpen}
    >
      <span className="top">
        <span className="who">{job.customer}</span>
        <span className="muted mono" style={{ fontSize: '0.75rem' }}>
          {job.id}
        </span>
      </span>
      <span className="what">{job.title}</span>
      <span className="foot">
        <span className="meta">
          <b>{dueLabel(job.dueIn)}</b>
          {alert && <span className="txt-hot"> · {alert}</span>}
        </span>
        <PayNote job={job} />
      </span>
    </button>
  );
}

// ───────── Fila de la lista de trabajos ─────────

export function JobRow({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const alert = jobAlert(job);
  return (
    <li>
      <button
        type="button"
        className="op jl-row"
        data-flag={jobFlag(job)}
        onClick={onOpen}
      >
        <span>
          <span className="who">{job.customer}</span>
          <br />
          <span className="what">{job.title}</span>
        </span>
        <span className="jl-meta">
          <span>
            <StatusBadge status={job.status} />
          </span>
          <span>
            <b>{dueLabel(job.dueIn)}</b>
            {alert && <span className="txt-hot"> · {alert}</span>}
          </span>
          <span>
            <PayNote job={job} />
          </span>
        </span>
        <span className="go mono muted" style={{ fontSize: '0.75rem' }}>
          {job.id}
        </span>
      </button>
    </li>
  );
}

// ───────── Bloque de pagos ─────────

export function PaymentBlock({
  job,
  onConfirmTransfer,
}: {
  job: Job;
  onConfirmTransfer?: () => void;
}) {
  const { confirmTransfer } = useStore();
  const toast = useToast();
  const balance = jobBalance(job);
  const pct = job.total ? Math.min(100, (job.paid / job.total) * 100) : 0;
  return (
    <section className="pay-block" aria-label="Pagos">
      <div className="section-head" style={{ margin: 0 }}>
        <h3 style={{ fontSize: '1.1rem' }}>Pagos</h3>
        {jobIsPaid(job) ? (
          <Badge tone="green" icon="check">
            Pagado
          </Badge>
        ) : job.status === 'awaiting_payment' ? (
          <Badge tone="amber" icon="hourglass">
            Esperando transferencia
          </Badge>
        ) : (
          <Badge tone="amber" icon="wallet">
            Con saldo
          </Badge>
        )}
      </div>
      <div className="pay-grid">
        <div className="pay-cell">
          <span className="k">Total</span>
          <span className="v">{ars(job.total)}</span>
        </div>
        <div className={`pay-cell ${job.paid > 0 ? 'pay-cell--ok' : ''}`}>
          <span className="k">Pagado</span>
          <span className="v">{ars(job.paid)}</span>
        </div>
        <div
          className={`pay-cell ${balance > 0 ? 'pay-cell--due' : 'pay-cell--ok'}`}
        >
          <span className="k">Saldo</span>
          <span className="v">{ars(balance)}</span>
        </div>
      </div>
      <div
        className="pay-bar"
        role="img"
        aria-label={`Pagado ${Math.round(pct)} por ciento`}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      {job.status === 'awaiting_payment' ? (
        <>
          <p className="meta">
            Alias <strong className="mono">{BANK_ALIAS}</strong> · no se imprime
            hasta acreditar.
          </p>
          {onConfirmTransfer && (
            <Button variant="primary" icon="check" onClick={onConfirmTransfer}>
              Confirmar transferencia
            </Button>
          )}
        </>
      ) : balance > 0 ? (
        <Button
          icon="cash"
          onClick={() => {
            confirmTransfer(job.id);
            toast(`Cobro registrado: ${ars(balance)}`, 'cash');
          }}
        >
          Registrar cobro del saldo ({ars(balance)})
        </Button>
      ) : null}
    </section>
  );
}

// ───────── Confirmar transferencia (acción administrativa, simulada) ─────────

export function ConfirmTransferSheet({
  job,
  onClose,
}: {
  job: Job | null;
  onClose: () => void;
}) {
  const { confirmTransfer } = useStore();
  const toast = useToast();
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(false), [job?.id]);
  return (
    <Sheet
      open={!!job}
      onClose={onClose}
      variant="modal"
      title="Confirmar transferencia"
      eyebrow={job?.id}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!ok}
            onClick={() => {
              if (!job) return;
              confirmTransfer(job.id);
              toast(
                `Transferencia confirmada · ${job.customer} pasa a «Recibido»`,
                'check',
              );
              onClose();
            }}
          >
            Confirmar {job ? ars(job.total) : ''}
          </Button>
        </>
      }
    >
      {job && (
        <>
          <dl className="kv">
            <div>
              <dt>Cliente</dt>
              <dd>{job.customer}</dd>
            </div>
            <div>
              <dt>Pedido</dt>
              <dd>{job.title}</dd>
            </div>
            <div>
              <dt>Alias esperado</dt>
              <dd className="mono">{BANK_ALIAS}</dd>
            </div>
            <div>
              <dt>Monto a verificar</dt>
              <dd style={{ fontSize: '1.4rem' }}>{ars(job.total)}</dd>
            </div>
          </dl>
          <label className="check">
            <input
              type="checkbox"
              checked={ok}
              onChange={(e) => setOk(e.target.checked)}
            />
            <span>
              Verifiqué en el banco que ingresaron <b>{ars(job.total)}</b>.
            </span>
          </label>
          <div className="notice">
            <Icon name="info" />
            <span>
              Pasa a <b>Recibido</b>, entra a Producción y el cliente ve «Pago
              confirmado».
            </span>
          </div>
        </>
      )}
    </Sheet>
  );
}

// ───────── Ficha de trabajo ─────────

function history(job: Job) {
  const idx = JOB_FLOW.indexOf(job.status);
  const out: { label: string; when?: string; current?: boolean }[] = [
    { label: 'Pedido creado', when: job.created },
  ];
  if (job.paid > 0)
    out.push({
      label: jobIsPaid(job)
        ? `Pago completo · ${ars(job.paid)}`
        : `Pago parcial · ${ars(job.paid)}`,
    });
  JOB_FLOW.slice(1, idx + 1).forEach((st) =>
    out.push({ label: STATUS_META[st].internal }),
  );
  if (job.status === 'awaiting_payment')
    out.push({ label: STATUS_META.awaiting_payment.internal });
  out[out.length - 1].current = true;
  return out;
}

const NEXT: Partial<
  Record<JobStatus, { label: string; icon: 'printer' | 'check' | 'store' }>
> = {
  received: { label: 'Empezar a imprimir', icon: 'printer' },
  in_progress: { label: 'Marcar listo y avisar', icon: 'check' },
  ready: { label: 'Entregar al cliente', icon: 'store' },
};

export function JobDrawer({
  jobId,
  onClose,
}: {
  jobId: string | null;
  onClose: () => void;
}) {
  const { jobs, advanceJob, toggleUrgent, sendWhatsapp, integrations } =
    useStore();
  const toast = useToast();
  const [confirm, setConfirm] = useState<Job | null>(null);
  const job = jobs.find((j) => j.id === jobId) ?? null;
  const wa = integrations.find((i) => i.id === 'whatsapp');

  const next = job ? NEXT[job.status] : undefined;
  const doNext = () => {
    if (!job) return;
    const s = advanceJob(job.id);
    if (s === 'ready') {
      toast(
        wa?.state === 'connected'
          ? `Listo · aviso de WhatsApp enviado a ${job.customer.split(' ')[0]}`
          : 'Listo · el aviso de WhatsApp queda en cola (WhatsApp requiere atención)',
        'chat',
      );
    } else if (s) {
      toast(`${job.id} → ${STATUS_META[s].internal}`, STATUS_META[s].icon);
    }
  };

  return (
    <>
      <Sheet
        open={!!job && !confirm}
        onClose={onClose}
        title={job?.customer ?? ''}
        eyebrow={job ? `${job.id} · ${job.created}` : undefined}
        footer={
          job && (
            <>
              {job.status === 'awaiting_payment' ? (
                <Button
                  variant="primary"
                  icon="check"
                  onClick={() => setConfirm(job)}
                >
                  Confirmar transferencia
                </Button>
              ) : next ? (
                <Button variant="primary" icon={next.icon} onClick={doNext}>
                  {job.status === 'ready' && jobBalance(job) > 0
                    ? `Cobrar ${ars(jobBalance(job))} y entregar`
                    : next.label}
                </Button>
              ) : null}
              <Button
                icon="bolt"
                onClick={() => toggleUrgent(job.id)}
                aria-pressed={job.urgent}
              >
                {job.urgent ? 'Quitar urgente' : 'Marcar urgente'}
              </Button>
            </>
          )
        }
      >
        {job && (
          <>
            <JobFlags job={job} />
            <div>
              <h3 style={{ fontSize: '1.4rem' }}>{job.title}</h3>
              <p className="meta">
                {plural(jobCopies(job), 'copia', 'copias')} · entrega{' '}
                {dueLabel(job.dueIn).toLowerCase()} ·{' '}
                {job.lane === 'lab' ? 'Laboratorio' : 'Edición'}
                {job.origin === 'web' && ' · Pedido web'}
              </p>
            </div>

            <ul className="order-lines" aria-label="Detalle">
              {job.lines.map((l) => (
                <li key={l.label}>
                  <div>
                    <span className="sz" style={{ fontSize: '1.15rem' }}>
                      {l.label}
                    </span>
                    <div className="muted">
                      {plural(l.qty, 'foto', 'fotos')} ·{' '}
                      {plural(l.copies, 'copia', 'copias')}
                    </div>
                  </div>
                  <span className="mono">{ars(l.price)}</span>
                </li>
              ))}
            </ul>

            <PaymentBlock job={job} />

            <section aria-label="Archivos">
              <div className="section-head" style={{ marginBottom: 6 }}>
                <h3 style={{ fontSize: '1.05rem' }}>Archivos</h3>
                <span
                  className={`meta ${job.drive === 'pending' ? 'txt-warn' : ''}`}
                >
                  {job.drive === 'ok'
                    ? plural(job.files, 'archivo', 'archivos')
                    : job.drive === 'pending'
                      ? `Subiendo · ${plural(job.files, 'archivo', 'archivos')}`
                      : 'Sin archivos'}
                </span>
              </div>
              {job.drive !== 'none' && (
                <Button
                  size="sm"
                  icon="folder"
                  onClick={() =>
                    toast(
                      'Se abriría la carpeta en Google Drive (simulado)',
                      'folder',
                    )
                  }
                >
                  Abrir carpeta en Drive
                </Button>
              )}
            </section>

            {(job.status === 'ready' || job.whatsapp !== 'none') && (
              <section aria-label="Aviso por WhatsApp">
                <div className="section-head" style={{ marginBottom: 6 }}>
                  <h3 style={{ fontSize: '1.05rem' }}>Aviso por WhatsApp</h3>
                  <span
                    className={`meta ${job.whatsapp === 'sent' ? 'txt-ok' : 'txt-warn'}`}
                  >
                    {job.whatsapp === 'sent' ? 'Enviado' : 'En cola'}
                  </span>
                </div>
                <p className="meta" style={{ marginBottom: 10 }}>
                  «Hola {job.customer.split(' ')[0]}, tu pedido {job.id} está
                  listo para retirar.» → {job.phone}
                </p>
                <Button
                  size="sm"
                  icon="chat"
                  onClick={() => {
                    sendWhatsapp(job.id);
                    toast(
                      job.whatsapp === 'sent'
                        ? 'Aviso reenviado'
                        : 'Aviso enviado',
                      'chat',
                    );
                  }}
                >
                  {job.whatsapp === 'sent' ? 'Reenviar aviso' : 'Enviar ahora'}
                </Button>
              </section>
            )}

            {job.notes && (
              <div className="notice">
                <Icon name="info" />
                <span>
                  <strong>Notas</strong>
                  {job.notes}
                </span>
              </div>
            )}

            <section aria-label="Historial">
              <h3 className="eyebrow" style={{ marginBottom: 6 }}>
                Historial
              </h3>
              <ol className="mini-list">
                {history(job).map((h) => (
                  <li key={h.label}>
                    <Icon
                      name={h.current ? 'clock' : 'check'}
                      size={18}
                      style={{ flex: 'none' }}
                    />
                    <span className="mini-body">
                      <strong>{h.label}</strong>
                    </span>
                    {h.when && <span className="meta">{h.when}</span>}
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </Sheet>
      <ConfirmTransferSheet job={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
