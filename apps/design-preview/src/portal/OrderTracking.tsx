import { Icon, type IconName } from '../icons';
import { useStore } from '../store';
import { Badge, Button, ButtonLink, Chip, StatusBadge, useToast } from '../ui';
import {
  BANK_ALIAS,
  DEMO_JOB_ID,
  JOB_FLOW,
  STATUS_META,
  STORE,
  ars,
  jobBalance,
  jobCopies,
  plural,
  type JobStatus,
} from '../data';
import { PortalShell } from './PortalShell';

const STEPS: {
  status: JobStatus;
  done: string;
  sub: string;
  icon: IconName;
  when: string;
}[] = [
  {
    status: 'awaiting_payment',
    done: 'Transferencia acreditada',
    sub: 'Esperamos tu transferencia para empezar.',
    icon: 'hourglass',
    when: 'Hoy 10:31',
  },
  {
    status: 'received',
    done: 'Pago confirmado',
    sub: 'Tu pedido pasa a la cola de impresión.',
    icon: 'check',
    when: 'Hoy 10:48',
  },
  {
    status: 'in_progress',
    done: 'En preparación',
    sub: 'Estamos imprimiendo y revisando tus fotos.',
    icon: 'printer',
    when: 'Hoy 11:20',
  },
  {
    status: 'ready',
    done: 'Listo para retirar',
    sub: 'Te avisamos por WhatsApp apenas esté.',
    icon: 'store',
    when: 'Hoy 12:05',
  },
  {
    status: 'delivered',
    done: 'Entregado',
    sub: 'Lo retiraste en el local.',
    icon: 'sparkle',
    when: 'Hoy 17:40',
  },
];

const HEADLINES: Record<JobStatus, (n: string) => { h: string; p: string }> = {
  awaiting_payment: (n) => ({
    h: `${n}, falta tu transferencia`,
    p: 'Apenas se acredite, empezamos a imprimir.',
  }),
  received: () => ({
    h: '¡Pago confirmado!',
    p: 'Tu pedido ya está en la cola de impresión.',
  }),
  in_progress: () => ({
    h: 'Estamos imprimiendo tus fotos',
    p: 'Falta poco. Te avisamos cuando esté listo.',
  }),
  ready: () => ({ h: '', p: '' }),
  delivered: (n) => ({
    h: `¡Gracias, ${n}!`,
    p: 'Esperamos que disfrutes tus fotos.',
  }),
};

export function OrderTracking() {
  const { jobs, setJobStatus } = useStore();
  const toast = useToast();
  const job = jobs.find((j) => j.id === DEMO_JOB_ID) ?? jobs[0];
  const first = job.customer.split(' ')[0];
  const idx = JOB_FLOW.indexOf(job.status);
  const head = HEADLINES[job.status](first);

  const simulate = (s: JobStatus) => {
    setJobStatus(job.id, s);
    toast(`Simulado: ${STATUS_META[s].public}`, 'sparkle');
  };

  return (
    <PortalShell>
      <div className="pt-page" style={{ paddingBottom: 190 }}>
        <div className="state-head">
          <p className="frame-tag">Pedido {job.id}</p>
          {job.status !== 'ready' && (
            <>
              <h1>{head.h}</h1>
              <p className="muted" style={{ fontSize: 'var(--fs-lg)' }}>
                {head.p}
              </p>
            </>
          )}
          {job.status !== 'ready' && (
            <div>
              <StatusBadge status={job.status} audience="public" large />
            </div>
          )}
        </div>

        {job.status === 'ready' && (
          <section className="ready on-dark" aria-labelledby="h-ready">
            <div className="film film--thin" aria-hidden="true" />
            <div className="ready-in">
              <span className="stamp" aria-hidden="true">
                <Icon name="check" />
              </span>
              <h2 id="h-ready">Listo para retirar</h2>
              <p>
                {first}, tu pedido <strong className="mono">{job.id}</strong> te
                espera en el local.
              </p>
              <div className="ready-info">
                <div className="ready-cell">
                  <span className="k">Dónde</span>
                  <span className="v">{STORE.address}</span>
                </div>
                <div className="ready-cell">
                  <span className="k">Horario</span>
                  <span className="v">{STORE.hours}</span>
                </div>
                <div className="ready-cell">
                  <span className="k">Código de retiro</span>
                  <span className="v big">{job.id}</span>
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                {jobBalance(job) === 0 ? (
                  <Badge tone="green" icon="check" large>
                    Pago acreditado · no debés nada
                  </Badge>
                ) : (
                  <Badge tone="amber" icon="alert" large>
                    Saldo a pagar {ars(jobBalance(job))}
                  </Badge>
                )}
                <Button variant="primary" icon="pin">
                  Cómo llegar
                </Button>
              </div>
            </div>
            <div className="film film--thin" aria-hidden="true" />
          </section>
        )}

        <section className="card card--pad" aria-labelledby="h-tl">
          <h2 id="h-tl" className="eyebrow" style={{ marginBottom: 18 }}>
            Estado de tu pedido
          </h2>
          <ol className="tl tl--h">
            {STEPS.map((s, i) => {
              const state =
                i < idx || (i === idx && job.status === 'delivered')
                  ? 'done'
                  : i === idx
                    ? 'current'
                    : 'todo';
              const title =
                state === 'done' ? s.done : STATUS_META[s.status].public;
              return (
                <li
                  key={s.status}
                  data-s={state}
                  aria-current={state === 'current' ? 'step' : undefined}
                >
                  <span className="node">
                    <Icon
                      name={state === 'done' ? 'check' : s.icon}
                      strokeWidth={state === 'done' ? 3 : 2}
                    />
                  </span>
                  <span className="txt">
                    <strong>{title}</strong>
                    <small>{s.sub}</small>
                    <span className="when">
                      {state === 'done'
                        ? s.when
                        : state === 'current'
                          ? 'Ahora'
                          : 'Pendiente'}
                    </span>
                    <span className="sr-only">
                      {state === 'done'
                        ? ' (completado)'
                        : state === 'current'
                          ? ' (paso actual)'
                          : ' (pendiente)'}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        {job.status === 'awaiting_payment' && (
          <div className="callout" role="note">
            <Icon name="wallet" />
            <div>
              <strong>
                Transferí {ars(job.total)} a {BANK_ALIAS}
              </strong>
              <p>La impresión se realiza una vez acreditado el pago.</p>
            </div>
          </div>
        )}

        <div className="callout callout--wa">
          <Icon name="chat" />
          <div>
            <strong>
              Te avisaremos por WhatsApp cuando tu pedido esté listo.
            </strong>
            <p>
              {job.whatsapp === 'sent' || job.status === 'ready'
                ? 'Ya te enviamos el aviso a '
                : 'Vamos a escribirte a '}
              <span className="mono">{job.phone}</span>.
            </p>
          </div>
        </div>

        <section className="card card--pad" aria-labelledby="h-det2">
          <div className="section-head">
            <h2 id="h-det2">Detalle</h2>
            <span className="muted">
              {plural(jobCopies(job), 'copia', 'copias')}
            </span>
          </div>
          <ul className="order-lines">
            {job.lines.map((l) => (
              <li key={l.label}>
                <div>
                  <span className="sz">{l.label}</span>
                  <div className="muted">
                    {plural(l.copies, 'copia', 'copias')}
                  </div>
                </div>
                <span className="mono">{ars(l.price)}</span>
              </li>
            ))}
          </ul>
          <div className="order-total">
            <span className="eyebrow">Total</span>
            <b className="num">{ars(job.total)}</b>
          </div>
        </section>

        <div className="row-actions">
          <ButtonLink to="/imprimir" icon="plus">
            Nuevo pedido
          </ButtonLink>
          <ButtonLink to="/imprimir/recibido" variant="ghost">
            Ver datos de transferencia
          </ButtonLink>
        </div>
      </div>

      {/* Control SOLO de la preview: no forma parte del producto */}
      <div className="sim">
        <div className="sim-in">
          <div className="eyebrow">
            <span>Solo preview · simular estado del pedido</span>
            <span className="muted">Paso {idx + 1} de 5</span>
          </div>
          <div className="chips" role="group" aria-label="Simular estado">
            {JOB_FLOW.map((s) => (
              <Chip
                key={s}
                pressed={job.status === s}
                onClick={() => simulate(s)}
                icon={STATUS_META[s].icon}
              >
                {STATUS_META[s].public}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </PortalShell>
  );
}
