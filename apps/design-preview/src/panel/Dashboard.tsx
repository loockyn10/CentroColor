import { useMemo, useState } from 'react';
import { Icon, type IconName } from '../icons';
import { Link, navigate } from '../router';
import { useStore } from '../store';
import { Button } from '../ui';
import {
  TODAY_INDEX,
  TODAY_LABEL,
  ars,
  dueLabel,
  events,
  frameJobsSeed,
  jobBalance,
  jobIsLate,
  plural,
} from '../data';
import { ConfirmTransferSheet, JobDrawer, PageHead } from './shared';

type Attn = {
  key: string;
  sev: 'high' | 'mid' | 'ok';
  icon: IconName;
  what: string;
  why: string;
  action: { label: string; run: () => void };
};

export function Dashboard() {
  const { jobs, appts, products, integrations, salesToday, salesCount } =
    useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const awaiting = jobs.filter((j) => j.status === 'awaiting_payment');
  const ready = jobs.filter((j) => j.status === 'ready');
  const late = jobs.filter(jobIsLate);
  const pending = (lane: 'lab' | 'edicion') =>
    jobs.filter(
      (j) =>
        j.lane === lane &&
        (j.status === 'received' || j.status === 'in_progress'),
    ).length;
  const lab = pending('lab');
  const edit = pending('edicion');
  const readyWithBalance = ready.filter((j) => jobBalance(j) > 0).length;
  const withBalance = jobs.filter(
    (j) =>
      j.status !== 'awaiting_payment' &&
      j.status !== 'delivered' &&
      jobBalance(j) > 0,
  );
  const todays = appts
    .filter((a) => a.day === TODAY_INDEX)
    .sort((a, b) => a.start.localeCompare(b.start));
  const nextAppt = todays.find((a) => a.status === 'programado');
  const upcoming = events.filter(
    (e) => e.status === 'reservado' || e.status === 'presupuestado',
  );
  const lowStock = products.filter((p) => p.stock !== null && p.stock <= p.min);
  const wa = integrations.find((i) => i.id === 'whatsapp');

  const attention = useMemo<Attn[]>(() => {
    const out: Attn[] = [];
    late.forEach((j) =>
      out.push({
        key: `late-${j.id}`,
        sev: 'high',
        icon: 'clock',
        what: `Atrasado · ${j.customer}`,
        why: `${j.title} · debía entregarse ${dueLabel(j.dueIn).toLowerCase()}`,
        action: { label: 'Abrir', run: () => setOpen(j.id) },
      }),
    );
    jobs
      .filter(
        (j) =>
          j.urgent &&
          !jobIsLate(j) &&
          j.status !== 'delivered' &&
          j.status !== 'ready',
      )
      .forEach((j) =>
        out.push({
          key: `urg-${j.id}`,
          sev: 'high',
          icon: 'bolt',
          what: `Urgente · ${j.customer}`,
          why: `${j.title} · entrega ${dueLabel(j.dueIn).toLowerCase()}`,
          action: { label: 'Abrir', run: () => setOpen(j.id) },
        }),
      );
    awaiting.forEach((j) =>
      out.push({
        key: `pay-${j.id}`,
        sev: 'mid',
        icon: 'hourglass',
        what: `Confirmar transferencia · ${j.customer} · ${ars(j.total)}`,
        why: `${j.title} · ${j.created.toLowerCase()}`,
        action: { label: 'Confirmar', run: () => setConfirm(j.id) },
      }),
    );
    if (wa && wa.state !== 'connected')
      out.push({
        key: 'wa',
        sev: 'mid',
        icon: 'chat',
        what: 'WhatsApp requiere atención',
        why: 'Los avisos de «listo para retirar» quedan en cola.',
        action: {
          label: 'Resolver',
          run: () => navigate('/panel/configuracion'),
        },
      });
    ready.forEach((j) =>
      out.push({
        key: `rdy-${j.id}`,
        sev: 'ok',
        icon: 'check',
        what: `Listo para entregar · ${j.customer}`,
        why:
          jobBalance(j) > 0
            ? `${j.title} · saldo a cobrar ${ars(jobBalance(j))}`
            : `${j.title} · pagado`,
        action: { label: 'Entregar', run: () => setOpen(j.id) },
      }),
    );
    if (lowStock.length)
      out.push({
        key: 'stock',
        sev: 'mid',
        icon: 'box',
        what: `${plural(lowStock.length, 'producto', 'productos')} con poco o sin stock`,
        why: lowStock
          .map((p) => p.name)
          .slice(0, 3)
          .join(' · '),
        action: { label: 'Ver stock', run: () => navigate('/panel/productos') },
      });
    const order = { high: 0, mid: 1, ok: 2 };
    return out.sort((a, b) => order[a.sev] - order[b.sev]);
  }, [late, jobs, awaiting, ready, lowStock, wa]);

  const confirmJob = jobs.find((j) => j.id === confirm) ?? null;
  const balanceTotal = withBalance.reduce((n, j) => n + jobBalance(j), 0);

  return (
    <div className="dash">
      <PageHead
        eyebrow={`${TODAY_LABEL} · Sucursal Esperanza`}
        title={
          <>
            ¿Qué necesita <span className="marker">atención hoy</span>?
          </>
        }
      >
        <Button
          variant="primary"
          icon="cart"
          onClick={() => navigate('/panel/pos')}
        >
          Nueva venta
        </Button>
        <Button icon="camera" onClick={() => navigate('/panel/trabajos')}>
          Nuevo trabajo
        </Button>
      </PageHead>

      <section className="dash-tiles" aria-label="Resumen del día">
        <div className="dash-kpis">
          <Link to="/panel/pos" className="tile">
            <span className="k">Ventas hoy</span>
            <span className="v">{ars(salesToday)}</span>
            <span className="s">{plural(salesCount, 'venta', 'ventas')}</span>
          </Link>
          <Link to="/panel/produccion" className="tile">
            <span className="k">Trabajos pendientes</span>
            <span className="v">{lab + edit}</span>
            <span className="s">
              {lab} laboratorio · {edit} edición
            </span>
          </Link>
          <Link to="/panel/trabajos" className="tile">
            <span className="k">Listos para entregar</span>
            <span className="v">{ready.length}</span>
            <span className="s">
              {readyWithBalance > 0
                ? `${readyWithBalance} con saldo`
                : 'Todos pagados'}
            </span>
          </Link>
          <Link
            to="/panel/pagos"
            className={`tile ${awaiting.length ? 'tile--alert' : ''}`}
          >
            <span className="k">Esperando pago</span>
            <span className="v">{awaiting.length}</span>
            <span className="s">
              {ars(awaiting.reduce((n, j) => n + j.total, 0))} por acreditar
            </span>
          </Link>
        </div>
      </section>

      <section className="card card--pad dash-attn" aria-labelledby="h-attn">
        <div className="section-head">
          <h2 id="h-attn">Para resolver ahora</h2>
          <span className="meta">{attention.length}</span>
        </div>
        <div className="attn">
          {attention.map((a) => (
            <div className="attn-row" key={a.key}>
              <span className={`sev sev--${a.sev}`} aria-hidden="true">
                <Icon name={a.icon} />
              </span>
              <div>
                <div className="what">
                  {a.sev === 'high' && (
                    <span className="sr-only">Alta prioridad: </span>
                  )}
                  {a.what}
                </div>
                <div className="why">{a.why}</div>
              </div>
              <div className="act">
                <Button size="sm" onClick={a.action.run}>
                  {a.action.label}
                </Button>
              </div>
            </div>
          ))}
          {attention.length === 0 && (
            <p className="muted">Todo al día. Nada requiere atención.</p>
          )}
        </div>
      </section>

      <div className="stack dash-side">
        <section className="card card--pad" aria-labelledby="h-turnos">
          <div className="section-head">
            <h2 id="h-turnos">Turnos de hoy</h2>
            <Link to="/panel/agenda" className="btn btn--ghost btn--sm">
              Agenda
            </Link>
          </div>
          <ul className="mini-list">
            {todays.slice(0, 4).map((a) => (
              <li key={a.id}>
                <span className="mini-time">{a.start}</span>
                <span className="mini-body">
                  <strong>{a.customer}</strong>
                  <span>
                    {a.type} · {a.minutes} min
                  </span>
                </span>
                {a.status !== 'programado' && (
                  <span
                    className={`meta ${a.status === 'completado' ? 'txt-ok' : 'txt-hot'}`}
                  >
                    {a.status}
                  </span>
                )}
              </li>
            ))}
            {todays.length === 0 && (
              <li>
                <span className="muted">Sin turnos hoy.</span>
              </li>
            )}
          </ul>
        </section>

        <section className="card card--pad" aria-label="Seguimiento">
          <nav className="glance" aria-label="Seguimiento">
            <Link to="/panel/pagos">
              <Icon name="wallet" />
              <span className="gl">Saldos pendientes</span>
              <span className="gv">{ars(balanceTotal)}</span>
            </Link>
            <Link to="/panel/eventos">
              <Icon name="star" />
              <span className="gl">
                Próximos eventos
                <span className="gs">
                  {upcoming[0]
                    ? `${upcoming[0].name} · ${upcoming[0].when}`
                    : 'Ninguno'}
                </span>
              </span>
              <span className="gv">{upcoming.length}</span>
            </Link>
            <Link to="/panel/marqueteria">
              <Icon name="frame" />
              <span className="gl">
                Marquetería
                <span className="gs">1 listo para retirar</span>
              </span>
              <span className="gv">{frameJobsSeed.length}</span>
            </Link>
            {nextAppt && (
              <Link to="/panel/agenda">
                <Icon name="calendar" />
                <span className="gl">
                  Próximo turno
                  <span className="gs">{nextAppt.customer}</span>
                </span>
                <span className="gv">{nextAppt.start}</span>
              </Link>
            )}
          </nav>
        </section>
      </div>

      <JobDrawer jobId={open} onClose={() => setOpen(null)} />
      <ConfirmTransferSheet job={confirmJob} onClose={() => setConfirm(null)} />
    </div>
  );
}
