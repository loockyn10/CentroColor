import { useState } from 'react';
import { Icon, type IconName } from '../icons';
import { useStore } from '../store';
import { Button, Chip, useToast } from '../ui';
import {
  dueLabel,
  jobIsLate,
  jobIsPaid,
  plural,
  type Job,
  type Lane,
} from '../data';
import {
  ConfirmTransferSheet,
  JobDrawer,
  PageHead,
  PayNote,
  StateLine,
  jobFlag,
} from './shared';

const LANES: { id: Lane; label: string; icon: IconName; hint: string }[] = [
  {
    id: 'lab',
    label: 'Laboratorio',
    icon: 'printer',
    hint: 'Impresión de fotos',
  },
  {
    id: 'edicion',
    label: 'Edición',
    icon: 'edit',
    hint: 'Retoque, restauración y digitalización',
  },
];

export function Production() {
  const { jobs } = useStore();
  const [onlyReady, setOnlyReady] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Job | null>(null);

  const active = jobs.filter((j) => j.status !== 'delivered');
  const rank = (j: Job) => {
    if (j.status === 'awaiting_payment') return 50; // bloqueados al final, con trama
    if (j.status === 'ready') return 40;
    return jobIsLate(j) ? 0 : j.urgent ? 1 : 10;
  };

  return (
    <>
      <PageHead title="Producción">
        <Chip
          pressed={onlyReady}
          icon="printer"
          onClick={() => setOnlyReady(!onlyReady)}
        >
          Listos para imprimir
        </Chip>
      </PageHead>

      {LANES.map((lane) => {
        const rows = active
          .filter((j) => j.lane === lane.id)
          .filter((j) => !onlyReady || (jobIsPaid(j) && j.status !== 'ready'))
          .sort((a, b) => rank(a) - rank(b) || a.dueIn - b.dueIn);
        const urgent = rows.filter((j) => j.urgent || jobIsLate(j)).length;
        const toPay = rows.filter(
          (j) => j.status === 'awaiting_payment',
        ).length;
        return (
          <section
            className="lane"
            key={lane.id}
            aria-labelledby={`lane-${lane.id}`}
          >
            <div className="lane-head on-dark">
              <span className="ico">
                <Icon name={lane.icon} />
              </span>
              <h2 id={`lane-${lane.id}`}>{lane.label}</h2>
              <span className="lane-stats">
                <span>{plural(rows.length, 'trabajo', 'trabajos')}</span>
                {urgent > 0 && (
                  <span className="hot">{urgent} urgentes o atrasados</span>
                )}
                {toPay > 0 && <span>{toPay} esperando pago</span>}
              </span>
            </div>
            {rows.length === 0 ? (
              <div className="empty">
                <Icon name="check" size={32} />
                <strong style={{ color: 'var(--text)' }}>
                  Sin trabajos en esta cola
                </strong>
              </div>
            ) : (
              <ul className="oplist">
                {rows.map((j) => (
                  <li key={j.id}>
                    <div
                      className="op"
                      data-flag={jobFlag(j)}
                      data-locked={j.status === 'awaiting_payment'}
                    >
                      <button
                        type="button"
                        className="op-open"
                        onClick={() => setOpen(j.id)}
                      >
                        <span className="who">{j.customer}</span>
                        <span className="what">
                          {j.title} · {dueLabel(j.dueIn)}
                          {j.drive === 'pending' && (
                            <span className="txt-warn">
                              {' '}
                              · Subiendo archivos
                            </span>
                          )}
                          <PayNote job={j} lead />
                          {j.origin === 'web' && ' · Web'}
                        </span>
                        <StateLine job={j} />
                      </button>
                      <div className="go">
                        <RowAction
                          job={j}
                          onOpen={() => setOpen(j.id)}
                          onConfirm={() => setConfirm(j)}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <JobDrawer jobId={open} onClose={() => setOpen(null)} />
      <ConfirmTransferSheet job={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function RowAction({
  job,
  onOpen,
  onConfirm,
}: {
  job: Job;
  onOpen: () => void;
  onConfirm: () => void;
}) {
  const { advanceJob } = useStore();
  const toast = useToast();
  if (job.status === 'awaiting_payment')
    return (
      <Button size="sm" variant="primary" icon="check" onClick={onConfirm}>
        Confirmar pago
      </Button>
    );
  if (job.status === 'received')
    return (
      <Button
        size="sm"
        icon="printer"
        onClick={() => {
          advanceJob(job.id);
          toast(`${job.id} → En proceso`, 'printer');
        }}
      >
        Empezar
      </Button>
    );
  if (job.status === 'in_progress')
    return (
      <Button
        size="sm"
        icon="check"
        onClick={() => {
          advanceJob(job.id);
          toast(
            `Listo · aviso de WhatsApp a ${job.customer.split(' ')[0]}`,
            'chat',
          );
        }}
      >
        Marcar listo
      </Button>
    );
  return (
    <Button size="sm" variant="ghost" className="hide-narrow" onClick={onOpen}>
      Abrir
    </Button>
  );
}
