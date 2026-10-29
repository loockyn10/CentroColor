import { useEffect, useMemo, useState } from 'react';
import type {
  AppointmentRepository,
  EventRepository,
  FramingRepository,
  InventoryRepository,
  PhotoJobSummary,
  PhotoRepository,
  ProductRepository,
  SaleRepository,
  WorkPaymentRepository,
} from '@centrocolor/application';
import { isPhotoJobOverdue, type WorkAccount } from '@centrocolor/domain';
import {
  Button,
  Card,
  Icon,
  Metric,
  PageHeader,
  type IconName,
} from '@centrocolor/ui';
import { useBusinessContext } from './auth';
import { dueText, money, plural, timeOfDay } from './format';

type Severity = 'high' | 'mid' | 'ok';
interface Attention {
  key: string;
  severity: Severity;
  icon: IconName;
  what: string;
  why: string;
  action: { label: string; run: () => void };
}

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

interface HomeData {
  salesToday: { count: number; totalCents: number } | null;
  jobs: PhotoJobSummary[] | null;
  accounts: WorkAccount[] | null;
  appointments: Array<{
    id: string;
    startsAt: string;
    customerName: string;
    title: string;
  }> | null;
  events: {
    count: number;
    next: { title: string; startsAt: string } | null;
  } | null;
  framingOpen: number | null;
  outOfStock: string[] | null;
}

const emptyData: HomeData = {
  salesToday: null,
  jobs: null,
  accounts: null,
  appointments: null,
  events: null,
  framingOpen: null,
  outOfStock: null,
};

/** Inicio: lo que necesita atención hoy. Cada fuente es opcional y falla sin romper el resto. */
export function HomePage({
  onRevalidate,
  appointmentRepository,
  eventRepository,
  photoRepository,
  paymentRepository,
  saleRepository,
  framingRepository,
  productRepository,
  inventoryRepository,
  refreshToken,
  onNavigate,
  onOpenJob,
}: {
  onRevalidate?: () => void;
  appointmentRepository?: AppointmentRepository;
  eventRepository?: EventRepository;
  photoRepository?: PhotoRepository;
  paymentRepository?: WorkPaymentRepository;
  saleRepository?: SaleRepository;
  framingRepository?: FramingRepository;
  productRepository?: ProductRepository;
  inventoryRepository?: InventoryRepository;
  refreshToken?: number;
  onNavigate?: (viewId: string) => void;
  onOpenJob?: (jobId: string) => void;
}) {
  const context = useBusinessContext();
  const { businessId, branchId, role } = context;
  const [data, setData] = useState<HomeData>(emptyData);

  useEffect(() => {
    if (!branchId) return;
    let live = true;
    const patch = (value: Partial<HomeData>) => {
      if (live) setData((current) => ({ ...current, ...value }));
    };
    const today = startOfToday();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    void saleRepository
      ?.list(businessId, 300)
      .then((sales) => {
        const todays = sales.filter(
          (sale) => new Date(sale.createdAt).getTime() >= today.getTime(),
        );
        patch({
          salesToday: {
            count: todays.length,
            totalCents: todays.reduce((sum, sale) => sum + sale.totalCents, 0),
          },
        });
      })
      .catch(() => undefined);
    void photoRepository
      ?.listJobs(businessId, branchId, {
        statuses: ['received', 'in_progress', 'ready'],
        limit: 200,
      })
      .then((jobs) => patch({ jobs }))
      .catch(() => undefined);
    if (role !== 'staff')
      void paymentRepository
        ?.listOutstanding(businessId, branchId)
        .then((accounts) => patch({ accounts }))
        .catch(() => undefined);
    void appointmentRepository
      ?.list({
        businessId,
        branchId,
        from: today.toISOString(),
        to: tomorrow.toISOString(),
        status: 'scheduled',
        limit: 100,
      })
      .then((rows) => patch({ appointments: rows }))
      .catch(() => undefined);
    if (eventRepository) {
      const from = new Date().toISOString();
      void Promise.all([
        eventRepository.countUpcomingEvents(businessId, branchId, from),
        eventRepository.listEvents({
          businessId,
          branchId,
          from,
          statuses: ['reserved'],
          limit: 1,
        }),
      ])
        .then(([count, rows]) =>
          patch({
            events: {
              count,
              next: rows[0]
                ? { title: rows[0].title, startsAt: rows[0].startsAt }
                : null,
            },
          }),
        )
        .catch(() => undefined);
    }
    void framingRepository
      ?.countOpenJobs(businessId, branchId)
      .then((framingOpen) => patch({ framingOpen }))
      .catch(() => undefined);
    if (productRepository && inventoryRepository)
      void productRepository
        .list(businessId, '', 500)
        .then(async (products) => {
          const tracked = products.filter(
            (product) => product.isActive && product.tracksInventory,
          );
          if (!tracked.length) return patch({ outOfStock: [] });
          const balances = await inventoryRepository.balances(
            businessId,
            branchId,
            tracked.map((product) => product.id),
          );
          const quantity = new Map(
            balances.map((row) => [row.productId, row.quantity]),
          );
          patch({
            outOfStock: tracked
              .filter((product) => (quantity.get(product.id) ?? 0) <= 0)
              .map((product) => product.name),
          });
        })
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [
    businessId,
    branchId,
    role,
    refreshToken,
    saleRepository,
    photoRepository,
    paymentRepository,
    appointmentRepository,
    eventRepository,
    framingRepository,
    productRepository,
    inventoryRepository,
  ]);

  const go = (id: string) => onNavigate?.(id);
  const openJob = (id: string) =>
    onOpenJob ? onOpenJob(id) : go('photo-jobs');

  const view = useMemo(() => {
    const jobs = data.jobs ?? [];
    const open = jobs.filter((row) =>
      ['received', 'in_progress'].includes(row.job.status),
    );
    const ready = jobs.filter((row) => row.job.status === 'ready');
    const late = jobs.filter((row) => isPhotoJobOverdue(row.job));
    const urgent = jobs.filter(
      (row) => row.job.priority === 'urgent' && !isPhotoJobOverdue(row.job),
    );
    const accounts = data.accounts ?? [];
    const balanceOf = (jobId: string) =>
      accounts.find(
        (account) =>
          account.sourceType === 'photo_job' && account.sourceId === jobId,
      )?.balanceCents ?? 0;
    const readyWithBalance = ready.filter((row) => balanceOf(row.job.id) > 0);
    return { open, ready, late, urgent, accounts, balanceOf, readyWithBalance };
  }, [data.jobs, data.accounts]);

  const attention = useMemo<Attention[]>(() => {
    const items: Attention[] = [];
    view.late.forEach((row) =>
      items.push({
        key: `late-${row.job.id}`,
        severity: 'high',
        icon: 'clock',
        what: `Atrasado · ${row.customerName}`,
        why: `${row.itemSummary || 'Pedido'} · debía entregarse ${dueText(row.job.promisedAt).toLowerCase()}`,
        action: { label: 'Abrir', run: () => openJob(row.job.id) },
      }),
    );
    view.urgent.forEach((row) =>
      items.push({
        key: `urgent-${row.job.id}`,
        severity: 'high',
        icon: 'bolt',
        what: `Urgente · ${row.customerName}`,
        why: `${row.itemSummary || 'Pedido'} · entrega ${dueText(row.job.promisedAt).toLowerCase()}`,
        action: { label: 'Abrir', run: () => openJob(row.job.id) },
      }),
    );
    // Un pedido listo sin saldo sólo espera su retiro: no es una alerta (ver «Listos para entregar»).
    view.readyWithBalance.forEach((row) =>
      items.push({
        key: `ready-${row.job.id}`,
        severity: 'mid',
        icon: 'wallet',
        what: `Cobrar y entregar · ${row.customerName}`,
        why: `${row.itemSummary || 'Pedido'} · saldo ${money(view.balanceOf(row.job.id))}`,
        action: { label: 'Abrir', run: () => openJob(row.job.id) },
      }),
    );
    if (data.outOfStock?.length)
      items.push({
        key: 'stock',
        severity: 'mid',
        icon: 'box',
        what: `${plural(data.outOfStock.length, 'producto', 'productos')} sin stock`,
        why: data.outOfStock.slice(0, 3).join(' · '),
        action: { label: 'Ver stock', run: () => go('stock') },
      });
    const order: Record<Severity, number> = { high: 0, mid: 1, ok: 2 };
    return items.sort((a, b) => order[a.severity] - order[b.severity]);
  }, [view, data.outOfStock, onNavigate, onOpenJob]);

  const showPayments = role !== 'staff' && paymentRepository;
  const owing = view.accounts.filter((account) => account.balanceCents > 0);
  const owedCents = owing.reduce(
    (sum, account) => sum + account.balanceCents,
    0,
  );

  const shown = attention.slice(0, 6);
  const hidden = attention.length - shown.length;
  const todaysAppointments = data.appointments ?? [];

  return (
    <div className="home">
      <PageHeader
        title="Hoy"
        actions={
          <Button icon="camera" onClick={() => go('new-photo-job')}>
            Nuevo pedido
          </Button>
        }
        primaryAction={
          <Button variant="primary" icon="cart" onClick={() => go('new-sale')}>
            Nueva venta
          </Button>
        }
      />
      {context.authorization === 'offline-authenticated' && (
        <p className="offline-notice">
          Modo offline · autorización local validada por última vez el{' '}
          {new Date(context.lastCloudValidationAt).toLocaleString('es-AR')}.{' '}
          {onRevalidate && (
            <button type="button" onClick={onRevalidate}>
              Revalidar acceso con Internet
            </button>
          )}
        </p>
      )}

      <section className="kpis" aria-label="Resumen del día">
        {saleRepository && (
          <Metric
            label="Ventas hoy"
            value={data.salesToday ? money(data.salesToday.totalCents) : '—'}
            hint={
              data.salesToday
                ? plural(data.salesToday.count, 'venta', 'ventas')
                : undefined
            }
            onClick={() => go('sales')}
          />
        )}
        {photoRepository && (
          <Metric
            label="Pedidos en curso"
            value={data.jobs ? view.open.length : '—'}
            hint={
              view.late.length
                ? plural(view.late.length, 'atrasado', 'atrasados')
                : undefined
            }
            tone={view.late.length ? 'alert' : undefined}
            onClick={() => go('photo-jobs')}
          />
        )}
        {photoRepository && (
          <Metric
            label="Listos para entregar"
            value={data.jobs ? view.ready.length : '—'}
            hint={
              view.readyWithBalance.length
                ? `${view.readyWithBalance.length} con saldo`
                : undefined
            }
            onClick={() => go('photo-jobs')}
          />
        )}
        {showPayments && (
          <Metric
            label="Por cobrar"
            value={data.accounts ? money(owedCents) : '—'}
            hint={
              owing.length
                ? plural(owing.length, 'cuenta', 'cuentas')
                : undefined
            }
            tone={owing.length ? 'warn' : undefined}
            onClick={() => go('payments')}
          />
        )}
      </section>

      <div className="home-grid">
        <Card className="home-attention">
          <div className="section-head">
            <h2>Para resolver ahora</h2>
            {attention.length > 0 && (
              <span className="meta">{attention.length}</span>
            )}
          </div>
          {attention.length === 0 ? (
            <p className="muted">Todo al día. Nada requiere atención.</p>
          ) : (
            <ul className="attn">
              {shown.map((item) => (
                <li className="attn-row" key={item.key}>
                  <span
                    className={`sev sev--${item.severity}`}
                    aria-hidden="true"
                  >
                    <Icon name={item.icon} />
                  </span>
                  <div className="attn-text">
                    <div className="what">
                      {item.severity === 'high' && (
                        <span className="sr-only">Alta prioridad: </span>
                      )}
                      {item.what}
                    </div>
                    <div className="why">{item.why}</div>
                  </div>
                  <Button size="sm" onClick={item.action.run}>
                    {item.action.label}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {hidden > 0 && (
            <p className="meta attn-more">
              y {plural(hidden, 'aviso más', 'avisos más')} en Pedidos, Cobros y
              Stock
            </p>
          )}
        </Card>

        <div className="home-side">
          {appointmentRepository && todaysAppointments.length > 0 && (
            <Card>
              <div className="section-head">
                <h2>Turnos de hoy</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => go('calendar')}
                >
                  Agenda
                </Button>
              </div>
              <ul className="mini-list">
                {todaysAppointments.slice(0, 4).map((row) => (
                  <li key={row.id}>
                    <span className="mini-time mono">
                      {timeOfDay(row.startsAt)}
                    </span>
                    <span className="mini-body">
                      <strong>{row.customerName}</strong>
                      <span className="meta">{row.title}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <nav className="glance" aria-label="Seguimiento">
              {appointmentRepository && todaysAppointments.length === 0 && (
                <button type="button" onClick={() => go('calendar')}>
                  <Icon name="calendar" />
                  <span className="gl">Turnos de hoy</span>
                  <span className="gv">{data.appointments ? 0 : '—'}</span>
                </button>
              )}
              {eventRepository && (
                <button type="button" onClick={() => go('events')}>
                  <Icon name="star" />
                  <span className="gl">
                    Próximas reservas
                    {data.events?.next && (
                      <span className="gs">
                        {data.events.next.title} ·{' '}
                        {new Date(data.events.next.startsAt).toLocaleDateString(
                          'es-AR',
                          { day: '2-digit', month: '2-digit' },
                        )}
                      </span>
                    )}
                  </span>
                  <span className="gv">{data.events?.count ?? '—'}</span>
                </button>
              )}
              {framingRepository && (
                <button type="button" onClick={() => go('frame-jobs')}>
                  <Icon name="frame" />
                  <span className="gl">Marquetería abierta</span>
                  <span className="gv">{data.framingOpen ?? '—'}</span>
                </button>
              )}
            </nav>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function PlaceholderPage({
  title,
  message = 'Esta sección se incorporará más adelante.',
}: {
  title: string;
  message?: string;
}) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <p className="muted">{message}</p>
      </Card>
    </>
  );
}
