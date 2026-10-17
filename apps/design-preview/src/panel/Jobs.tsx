import { useMemo, useState } from 'react';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Button, Chip, Segmented, StatusBadge } from '../ui';
import {
  JOB_FLOW,
  STATUS_META,
  jobBalance,
  jobIsLate,
  type Job,
} from '../data';
import {
  JobCard,
  JobDrawer,
  JobRow,
  PageHead,
  jobFlag,
  useMedia,
} from './shared';

type Filter = 'all' | 'pay' | 'urgent' | 'late' | 'ready' | 'web' | 'balance';

const FILTERS: {
  id: Filter;
  label: string;
  icon?: 'hourglass' | 'bolt' | 'clock' | 'check' | 'globe' | 'wallet';
  test: (j: Job) => boolean;
}[] = [
  { id: 'all', label: 'Todos', test: () => true },
  {
    id: 'pay',
    label: 'Esperando pago',
    icon: 'hourglass',
    test: (j) => j.status === 'awaiting_payment',
  },
  {
    id: 'urgent',
    label: 'Urgentes',
    icon: 'bolt',
    test: (j) => j.urgent && j.status !== 'delivered',
  },
  { id: 'late', label: 'Atrasados', icon: 'clock', test: jobIsLate },
  {
    id: 'ready',
    label: 'Listos para entregar',
    icon: 'check',
    test: (j) => j.status === 'ready',
  },
  {
    id: 'web',
    label: 'Origen web',
    icon: 'globe',
    test: (j) => j.origin === 'web',
  },
  {
    id: 'balance',
    label: 'Con saldo',
    icon: 'wallet',
    test: (j) => jobBalance(j) > 0 && j.status !== 'delivered',
  },
];

export function Jobs() {
  const { jobs } = useStore();
  const [view, setView] = useState<'board' | 'list'>('list');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const wide = useMedia('(min-width: 1000px)');

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!;
    return jobs.filter(
      (j) =>
        f.test(j) &&
        (!needle ||
          (j.customer + j.title + j.id).toLowerCase().includes(needle)),
    );
  }, [jobs, filter, needle]);

  const sorter = (a: Job, b: Job) => {
    const w = { late: 0, urgent: 1, pay: 2, ready: 3 } as Record<
      string,
      number
    >;
    const rank = (j: Job) =>
      j.status === 'delivered' ? 9 : (w[`${jobFlag(j)}`] ?? 4);
    return rank(a) - rank(b) || a.dueIn - b.dueIn;
  };

  return (
    <>
      <PageHead title="Trabajos fotográficos">
        <Segmented
          label="Vista"
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: 'Lista' },
            { value: 'board', label: 'Tablero' },
          ]}
        />
        <Button variant="primary" icon="plus">
          Nuevo trabajo
        </Button>
      </PageHead>

      <div className="toolbar">
        <div className="search-wrap">
          <Icon name="search" />
          <input
            className="input input--search"
            type="search"
            placeholder="Cliente, trabajo o código…"
            aria-label="Buscar trabajos"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <div
        className="chips chips--scroll"
        role="group"
        aria-label="Filtros"
        style={{ marginBottom: 18 }}
      >
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            pressed={filter === f.id}
            count={jobs.filter(f.test).length}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </Chip>
        ))}
      </div>

      {view === 'board' && wide ? (
        <div className="board" role="list" aria-label="Tablero de trabajos">
          {JOB_FLOW.map((s) => {
            const col = shown.filter((j) => j.status === s).sort(sorter);
            return (
              <section
                className="col"
                data-s={s}
                key={s}
                role="listitem"
                aria-label={STATUS_META[s].internal}
              >
                <div className="col-head">
                  <h3>
                    <StatusBadge status={s} />
                  </h3>
                  <span className="count">{col.length}</span>
                </div>
                {col.map((j) => (
                  <JobCard key={j.id} job={j} onOpen={() => setOpen(j.id)} />
                ))}
                {col.length === 0 && (
                  <p
                    className="muted"
                    style={{ padding: 8, fontSize: 'var(--fs-sm)' }}
                  >
                    Sin trabajos
                  </p>
                )}
              </section>
            );
          })}
        </div>
      ) : view === 'board' ? (
        <div className="stack" style={{ gap: 22 }}>
          {JOB_FLOW.map((s) => {
            const col = shown.filter((j) => j.status === s).sort(sorter);
            if (!col.length) return null;
            return (
              <section key={s} aria-label={STATUS_META[s].internal}>
                <div className="section-head">
                  <h2 style={{ fontSize: '1.1rem' }}>
                    <StatusBadge status={s} large />
                  </h2>
                  <span className="mono">{col.length}</span>
                </div>
                <div className="m-cards">
                  {col.map((j) => (
                    <JobCard key={j.id} job={j} onOpen={() => setOpen(j.id)} />
                  ))}
                </div>
              </section>
            );
          })}
          {shown.length === 0 && <NoResults />}
        </div>
      ) : (
        <JobTable jobs={[...shown].sort(sorter)} onOpen={setOpen} />
      )}

      <JobDrawer jobId={open} onClose={() => setOpen(null)} />
    </>
  );
}

function NoResults() {
  return (
    <div className="empty">
      <Icon name="search" size={36} />
      <strong style={{ color: 'var(--text)' }}>
        No hay trabajos con ese filtro
      </strong>
    </div>
  );
}

function JobTable({
  jobs,
  onOpen,
}: {
  jobs: Job[];
  onOpen: (id: string) => void;
}) {
  if (!jobs.length) return <NoResults />;
  return (
    <div className="oplist-card">
      <div className="jl-head" aria-hidden="true">
        <span>Cliente y trabajo</span>
        <span>Estado</span>
        <span>Entrega</span>
        <span>Pago</span>
        <span style={{ textAlign: 'right' }}>Código</span>
      </div>
      <ul className="oplist" aria-label="Lista de trabajos fotográficos">
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} onOpen={() => onOpen(j.id)} />
        ))}
      </ul>
    </div>
  );
}
