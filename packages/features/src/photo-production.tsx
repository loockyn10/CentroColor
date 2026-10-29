import { useEffect, useState } from 'react';
import type {
  PhotoFileIntakeAdminRepository,
  PhotoJobBundle,
  PhotoJobNotificationRepository,
  PhotoRepository,
} from '@centrocolor/application';
import {
  comparePhotoProductionQueue,
  isPhotoJobOverdue,
  type PhotoJobStatus,
} from '@centrocolor/domain';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  FlashMessage,
  PageHeader,
  StatusBadge,
  useFlash,
} from '@centrocolor/ui';
import { dueText, plural } from './format';
import { useBusinessContext } from './auth';
import { errorText } from './photo';
import { productionJobStatus, statusMeta } from './status';

type ProductionRow = {
  bundle: PhotoJobBundle;
  item: PhotoJobBundle['items'][number];
  route: 'lab' | 'editing';
  files: NonNullable<PhotoJobBundle['files']>;
};
type Lane = 'lab' | 'editing';
type StatusFilter = 'all' | 'received' | 'in_progress' | 'ready';
const laneLabel: Record<Lane, string> = {
  lab: 'Laboratorio',
  editing: 'Edición',
};
const statusFilters: Array<[StatusFilter, string]> = [
  ['all', 'Todos'],
  ['received', 'Pendiente'],
  ['in_progress', 'En proceso'],
  ['ready', 'Listo'],
];
const isUrgentOrLate = (job: PhotoJobBundle['job']) =>
  job.priority === 'urgent' || isPhotoJobOverdue(job);

type ProductionJob = {
  key: string;
  bundle: PhotoJobBundle;
  route: 'lab' | 'editing';
  services: string[];
  files: NonNullable<PhotoJobBundle['files']>;
};

/**
 * Producción: la cola de Laboratorio y de Edición, pensada para una tablet de ~10". Una fila por
 * trabajo y carril; las acciones ocupan siempre las mismas columnas (En proceso · Listo · Drive ·
 * Abrir). La carga, el armado de colas y el cambio de estado no cambiaron: sólo la presentación.
 */
export function PhotoProductionPage({
  repository,
  fileIntakeRepository,
  notificationRepository,
  refreshToken,
  onOpenJob,
  onMutation,
}: {
  repository: PhotoRepository;
  fileIntakeRepository?: PhotoFileIntakeAdminRepository;
  /** Web: avisa a la nube de que el pedido quedó listo (el aviso de WhatsApp lo envía ella). */
  notificationRepository?: PhotoJobNotificationRepository;
  refreshToken?: number;
  onOpenJob?: (jobId: string) => void;
  onMutation?: () => void;
}) {
  const c = useBusinessContext();
  const [rows, setRows] = useState<ProductionRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const flash = useFlash();
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [lane, setLane] = useState<Lane>('lab');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    void repository
      .listJobs(c.businessId, c.branchId!, {
        statuses: ['received', 'in_progress', 'ready'],
        limit: 300,
      })
      .then(
        async (jobs) =>
          (
            await Promise.all(
              jobs
                .filter((x) => x.job.fileIntakeStatus === 'submitted')
                .map((x) => repository.getJob(c.businessId, x.job.id)),
            )
          ).filter(Boolean) as PhotoJobBundle[],
      )
      .then((bundles) => {
        const next: ProductionRow[] = [];
        for (const bundle of bundles)
          for (const item of bundle.items.filter((x) => x.isActive)) {
            const files = (bundle.files ?? []).filter(
              (x) => x.photoJobItemId === item.id && x.status === 'uploaded',
            );
            const route = files[0]?.workflowRoute;
            if ((route === 'lab' || route === 'editing') && files.length)
              next.push({ bundle, item, route, files });
          }
        next.sort((a, b) =>
          comparePhotoProductionQueue(a.bundle.job, b.bundle.job),
        );
        if (live) {
          setRows(next);
          setLoaded(true);
        }
      })
      .catch((x) => live && flash.error(errorText(x)));
    return () => {
      live = false;
    };
  }, [repository, c.businessId, c.branchId, refreshToken, reload]);
  const openFolder = (id: string) =>
    fileIntakeRepository?.openDriveFolder(id) ??
    window.open(
      `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`,
      '_blank',
      'noopener,noreferrer',
    );

  const queue = (route: 'lab' | 'editing'): ProductionJob[] => {
    const byJob = new Map<string, ProductionJob>();
    for (const row of rows.filter((x) => x.route === route)) {
      const found = byJob.get(row.bundle.job.id);
      if (found) {
        found.services.push(row.item.serviceNameSnapshot);
        found.files.push(...row.files);
      } else
        byJob.set(row.bundle.job.id, {
          key: `${route}:${row.bundle.job.id}`,
          bundle: row.bundle,
          route,
          services: [row.item.serviceNameSnapshot],
          files: [...row.files],
        });
    }
    return [...byJob.values()];
  };

  async function advance(job: ProductionJob, next: PhotoJobStatus) {
    setBusyJob(job.bundle.job.id);
    flash.clear();
    try {
      await repository.setJobStatus(c.businessId, job.bundle.job.id, next);
      if (next === 'ready' && job.bundle.job.sourceChannel === 'public_web')
        await notificationRepository?.wake(c.businessId, job.bundle.job.id);
      setReload((x) => x + 1);
      onMutation?.();
    } catch (x) {
      flash.error(errorText(x));
    } finally {
      setBusyJob(null);
    }
  }

  const laneJobs = queue(lane);
  const laneUrgent = (route: Lane) =>
    queue(route).filter((x) => isUrgentOrLate(x.bundle.job)).length;
  const countBy = (status: StatusFilter) =>
    status === 'all'
      ? laneJobs.length
      : laneJobs.filter((x) => x.bundle.job.status === status).length;
  const visible =
    filter === 'all'
      ? laneJobs
      : laneJobs.filter((x) => x.bundle.job.status === filter);

  return (
    <div className="production">
      <PageHeader title="Producción" />
      <FlashMessage flash={flash} />
      <div className="prod-filters">
        <div className="seg prod-lanes" role="group" aria-label="Cola">
          {(['lab', 'editing'] as const).map((route) => {
            const urgent = laneUrgent(route);
            return (
              <button
                key={route}
                type="button"
                aria-pressed={lane === route}
                onClick={() => setLane(route)}
              >
                {laneLabel[route]}
                <span className="prod-count">{queue(route).length}</span>
                {urgent > 0 && (
                  <span className="prod-hot">
                    {urgent} {urgent === 1 ? 'urgente' : 'urgentes'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="chips" role="group" aria-label="Estado">
          {statusFilters.map(([id, label]) => (
            <Chip
              key={id}
              pressed={filter === id}
              count={countBy(id)}
              onClick={() => setFilter(id)}
            >
              {label}
            </Chip>
          ))}
        </div>
      </div>
      <Card className="card--flush">
        {!loaded ? (
          <p className="pad meta">Cargando cola…</p>
        ) : visible.length === 0 ? (
          <EmptyState
            icon="printer"
            title={
              filter === 'all'
                ? `No hay pedidos en ${laneLabel[lane]}`
                : `No hay pedidos «${statusFilters.find(([id]) => id === filter)![1]}» en ${laneLabel[lane]}`
            }
          />
        ) : (
          <div className="rows">
            {visible.map((job) => {
              const j = job.bundle.job;
              const busy = busyJob === j.id;
              const copies = job.files.reduce((s, x) => s + x.copies, 0);
              const overdue = isPhotoJobOverdue(j);
              const urgent = j.priority === 'urgent';
              const flag =
                overdue || urgent
                  ? 'alert'
                  : j.status === 'ready'
                    ? 'ok'
                    : undefined;
              const state = statusMeta(productionJobStatus, j.status);
              const pending = j.status === 'received';
              const open = ['received', 'in_progress'].includes(j.status);
              return (
                <div className="prod-row" data-flag={flag} key={job.key}>
                  <div className="prod-main">
                    <strong className="prod-who">
                      {job.bundle.customerName}
                    </strong>
                    <span className="prod-what">
                      {job.services.join(' · ')}
                    </span>
                    <span className="prod-meta">
                      {plural(job.files.length, 'archivo', 'archivos')}
                      {lane === 'lab' ? ` · ${copies} copias` : ''}
                      {j.sourceChannel === 'public_web' ? ' · Pedido web' : ''}
                    </span>
                  </div>
                  <div className="prod-when">
                    <span className={overdue ? 'txt-alert' : 'prod-due'}>
                      {dueText(j.promisedAt)}
                    </span>
                    <span className="prod-badges">
                      {urgent && (
                        <StatusBadge tone="alert">Urgente</StatusBadge>
                      )}
                      {overdue && (
                        <StatusBadge tone="alert">Atrasado</StatusBadge>
                      )}
                      <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                    </span>
                  </div>
                  <div className="prod-actions">
                    <span className="prod-slot">
                      {pending && (
                        <Button
                          size="lg"
                          variant="primary"
                          block
                          disabled={busy}
                          onClick={() => void advance(job, 'in_progress')}
                        >
                          En proceso
                        </Button>
                      )}
                    </span>
                    <span className="prod-slot">
                      {open ? (
                        <Button
                          size="lg"
                          variant={pending ? 'secondary' : 'primary'}
                          block
                          disabled={busy}
                          onClick={() => void advance(job, 'ready')}
                        >
                          Listo
                        </Button>
                      ) : (
                        <span className="prod-done">Para entregar</span>
                      )}
                    </span>
                    <span className="prod-slot">
                      <Button
                        size="lg"
                        variant="secondary"
                        block
                        icon="folder"
                        onClick={() => openFolder(job.files[0]!.driveFolderId)}
                      >
                        {lane === 'editing' ? 'Originales' : 'Drive'}
                      </Button>
                    </span>
                    <span className="prod-slot">
                      {onOpenJob && (
                        <Button
                          size="lg"
                          variant="ghost"
                          block
                          onClick={() => onOpenJob(j.id)}
                        >
                          Abrir
                        </Button>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
