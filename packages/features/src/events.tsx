import { useEffect, useState } from 'react';
import {
  createEventType,
  createResource,
  updateEventType,
  updateResource,
  type CustomerRepository,
  type EventRepository,
  type EventSummary,
  type ResourceReservationSummary,
  type ServiceCatalogRepository,
  type WorkPaymentRepository,
} from '@centrocolor/application';
import {
  eventStatuses,
  type EventStatus,
  type EventType,
  type Resource,
} from '@centrocolor/domain';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  PageHeader,
  Segmented,
  InlineMessage,
  takeCreateIntent,
  Chip,
  FilterBar,
  StatusBadge,
  FormDrawer,
} from '@centrocolor/ui';
import { useBusinessContext } from './auth';
import { AgendaBar } from './editor-parts';
import { eventStatus, statusMeta } from './status';
import { EventEditor } from './event-editor';
import {} from './payments';
import {} from './event-service-composer';
import { ResourceCapacityPanel } from './resource-capacity';
import { CatalogRow, CatalogSection } from './configuration-ui';

const statusLabels: Record<EventStatus, string> = {
  inquiry: 'Consulta',
  quoted: 'Presupuestado',
  reserved: 'Reservado',
  completed: 'Realizado',
  cancelled: 'Cancelado',
};
const pad = (x: number) => String(x).padStart(2, '0');
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const startOfWeek = (d: Date) =>
  addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const money = (cents: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(
    cents / 100,
  );
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  });
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Ocurrió un error. Reintentá.';

export function EventTypesPage({
  repository,
  onMutation,
  embedded = false,
}: {
  repository: EventRepository;
  onMutation?: () => void;
  embedded?: boolean;
}) {
  const context = useBusinessContext();
  const canManage = ['owner', 'admin'].includes(context.role);
  const [types, setTypes] = useState<EventType[]>([]);
  const [name, setName] = useState('');
  const [drawer, setDrawer] = useState<'new' | EventType | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void repository
      .listTypes(context.businessId, true)
      .then(setTypes)
      .catch((e) => setError(errorText(e)));
  }, [repository, context.businessId, refresh]);
  function open(target: 'new' | EventType) {
    setName(target === 'new' ? '' : target.name);
    setError(null);
    setDrawer(target);
  }
  async function save() {
    try {
      if (drawer && drawer !== 'new')
        await updateEventType(repository, context.businessId, drawer.id, {
          name,
        });
      else await createEventType(repository, context.businessId, { name });
      setDrawer(null);
      setRefresh((x) => x + 1);
      onMutation?.();
    } catch (err) {
      setError(errorText(err));
    }
  }
  async function toggle(type: EventType) {
    try {
      await repository.setTypeActive(
        context.businessId,
        type.id,
        !type.isActive,
      );
      setDrawer(null);
      setRefresh((n) => n + 1);
      onMutation?.();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <>
      {!embedded && <PageHeader title="Tipos de presupuesto y reserva" />}
      {error && !drawer && <InlineMessage tone="error">{error}</InlineMessage>}
      <CatalogSection
        title="Tipos de presupuesto y reserva"
        action={
          canManage ? (
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              onClick={() => open('new')}
            >
              Nuevo tipo
            </Button>
          ) : undefined
        }
      >
        {types.length === 0 ? (
          <p className="meta price-empty">Todavía no hay tipos.</p>
        ) : (
          types.map((x) => (
            <CatalogRow
              key={x.id}
              title={x.name}
              active={x.isActive}
              onEdit={canManage ? () => open(x) : undefined}
            />
          ))
        )}
      </CatalogSection>
      <FormDrawer
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        title={drawer && drawer !== 'new' ? 'Editar tipo' : 'Nuevo tipo'}
        error={error}
        onSubmit={save}
      >
        <label>
          Nombre
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {drawer && drawer !== 'new' && (
          <section className="drawer-section">
            <h3>Estado</h3>
            <Button
              variant={drawer.isActive ? 'danger' : 'secondary'}
              onClick={() => void toggle(drawer)}
            >
              {drawer.isActive ? 'Desactivar tipo' : 'Activar tipo'}
            </Button>
          </section>
        )}
      </FormDrawer>
    </>
  );
}

export function EventsPage({
  repository,
  customerRepository,
  serviceCatalogRepository,
  paymentRepository,
  refreshToken,
  onMutation,
}: {
  repository: EventRepository;
  customerRepository: CustomerRepository;
  serviceCatalogRepository: ServiceCatalogRepository;
  paymentRepository: WorkPaymentRepository;
  refreshToken?: number;
  onMutation?: () => void;
}) {
  const context = useBusinessContext();
  const [layout, setLayout] = useState<'board' | 'list'>('board');
  const [filter, setFilter] = useState<'upcoming' | EventStatus>('upcoming');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<EventSummary[]>([]);
  const [editor, setEditor] = useState<string | true | null>(null);
  useEffect(() => {
    // Alta pedida desde el menú «Nuevo»: abre el editor directamente.
    if (takeCreateIntent('events')) setEditor(true);
  }, []);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      const statuses =
        filter === 'upcoming'
          ? (['inquiry', 'quoted', 'reserved'] as EventStatus[])
          : [filter];
      void repository
        .listEvents({
          businessId: context.businessId,
          branchId: context.branchId!,
          from: filter === 'upcoming' ? new Date().toISOString() : undefined,
          statuses,
          query,
          limit: 500,
        })
        .then((x) => live && setRows(x))
        .catch((e) => live && setError(errorText(e)));
    }, 160);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    repository,
    context.businessId,
    context.branchId,
    filter,
    query,
    refresh,
    refreshToken,
  ]);
  function saved() {
    setEditor(null);
    setRefresh((x) => x + 1);
    onMutation?.();
  }
  const boardStatuses: EventStatus[] = ['inquiry', 'quoted', 'reserved'];
  const asBoard = filter === 'upcoming' && layout === 'board';
  const card = (x: EventSummary) => (
    <button
      type="button"
      className="oprow event-row"
      key={x.id}
      onClick={() => setEditor(x.id)}
    >
      <time className="event-date">
        <strong>
          {new Date(x.startsAt).toLocaleDateString('es-AR', {
            day: '2-digit',
            month: 'short',
          })}
        </strong>
        <span className="meta">{time(x.startsAt)}</span>
      </time>
      <span className="what">
        <strong>{x.title}</strong>
        <span className="meta block">
          {x.customerName}
          {x.eventTypeName ? ` · ${x.eventTypeName}` : ''}
        </span>
      </span>
      <span className="meta">{x.venueName || '—'}</span>
      <span className="when">
        <strong className="num">{money(x.totalCents)}</strong>
        <span className="meta">
          {x.resourceNames.join(' + ') || 'Sin recursos'}
        </span>
      </span>
      {!asBoard && (
        <StatusBadge tone={statusMeta(eventStatus, x.status).tone}>
          {statusLabels[x.status]}
        </StatusBadge>
      )}
    </button>
  );
  return (
    <>
      <PageHeader
        title="Presupuestos y reservas"
        primaryAction={
          <Button variant="primary" icon="plus" onClick={() => setEditor(true)}>
            Nuevo presupuesto
          </Button>
        }
      />
      <FilterBar
        label="Filtrar presupuestos y reservas"
        search={
          <div className="search-field">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Buscar presupuestos y reservas"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cliente, título o lugar"
            />
          </div>
        }
        end={
          filter === 'upcoming' ? (
            <Segmented
              label="Vista"
              value={layout}
              onChange={setLayout}
              options={[
                { value: 'board', label: 'Tablero' },
                { value: 'list', label: 'Lista' },
              ]}
            />
          ) : undefined
        }
      >
        <Chip
          pressed={filter === 'upcoming'}
          onClick={() => setFilter('upcoming')}
        >
          Próximos
        </Chip>
        {eventStatuses.map((x) => (
          <Chip key={x} pressed={filter === x} onClick={() => setFilter(x)}>
            {statusLabels[x]}
          </Chip>
        ))}
      </FilterBar>
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
      {asBoard ? (
        <div className="board board--events">
          {boardStatuses.map((status) => {
            const column = rows.filter((x) => x.status === status);
            return (
              <section
                className="board-col"
                key={status}
                aria-label={statusLabels[status]}
              >
                <header>
                  <h2>{statusLabels[status]}</h2>
                  <span className="meta">{column.length}</span>
                </header>
                {column.map(card)}
                {column.length === 0 && (
                  <p className="meta pad">Sin reservas.</p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <Card className="card--flush">
          {rows.length === 0 ? (
            <EmptyState
              icon="star"
              title="No hay presupuestos ni reservas para este filtro"
            />
          ) : (
            <div className="rows">{rows.map(card)}</div>
          )}
        </Card>
      )}
      {editor && (
        <EventEditor
          repository={repository}
          customerRepository={customerRepository}
          serviceCatalogRepository={serviceCatalogRepository}
          paymentRepository={paymentRepository}
          onMutation={onMutation}
          eventId={typeof editor === 'string' ? editor : undefined}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
    </>
  );
}

export function ResourcesPage({
  repository,
  serviceCatalogRepository,
  refreshToken,
  onMutation,
}: {
  repository: EventRepository;
  serviceCatalogRepository?: ServiceCatalogRepository;
  refreshToken?: number;
  onMutation?: () => void;
}) {
  const context = useBusinessContext();
  const canManage = ['owner', 'admin'].includes(context.role);
  const [rows, setRows] = useState<Resource[]>([]);
  const [drawer, setDrawer] = useState<'new' | Resource | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void repository
      .listResources(context.businessId, true)
      .then(setRows)
      .catch((e) => setError(errorText(e)));
  }, [repository, context.businessId, refresh, refreshToken]);
  function open(target: 'new' | Resource) {
    setName(target === 'new' ? '' : target.name);
    setDescription(target === 'new' ? '' : (target.description ?? ''));
    setError(null);
    setDrawer(target);
  }
  async function save() {
    try {
      const editing = drawer && drawer !== 'new' ? drawer : null;
      const details = {
        name,
        description: description || null,
        // El precio del recurso es legado. Se preserva al editar y los equipos
        // nuevos nacen sin precio comercial; las tarifas pertenecen al servicio.
        defaultPriceCents: editing?.defaultPriceCents ?? null,
      };
      if (editing)
        await updateResource(
          repository,
          context.businessId,
          editing.id,
          details,
        );
      else await createResource(repository, context.businessId, details);
      setDrawer(null);
      setRefresh((x) => x + 1);
      onMutation?.();
    } catch (err) {
      setError(errorText(err));
    }
  }
  async function toggle(resource: Resource) {
    try {
      await repository.setResourceActive(
        context.businessId,
        resource.id,
        !resource.isActive,
      );
      setDrawer(null);
      setRefresh((n) => n + 1);
      onMutation?.();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <>
      <PageHeader
        title="Recursos"
        primaryAction={
          canManage ? (
            <Button variant="primary" icon="plus" onClick={() => open('new')}>
              Nuevo equipo
            </Button>
          ) : undefined
        }
      />
      {error && !drawer && <InlineMessage tone="error">{error}</InlineMessage>}
      <Card className="card--flush">
        {rows.length === 0 ? (
          <EmptyState icon="bolt" title="Todavía no hay equipos" />
        ) : (
          <div className="rows catalog-rows">
            {rows.map((resource) => (
              <CatalogRow
                key={resource.id}
                title={resource.name}
                meta={resource.description || undefined}
                active={resource.isActive}
                onEdit={canManage ? () => open(resource) : undefined}
              />
            ))}
          </div>
        )}
      </Card>
      <FormDrawer
        open={canManage && drawer !== null}
        onClose={() => setDrawer(null)}
        title={
          drawer && drawer !== 'new'
            ? 'Editar equipo físico'
            : 'Nuevo equipo físico'
        }
        error={error}
        submitLabel={
          drawer && drawer !== 'new' ? 'Guardar cambios' : 'Crear equipo'
        }
        onSubmit={save}
      >
        <label>
          Nombre
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Tipo / descripción
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej. Proyector, controlador LED, pantalla"
          />
        </label>
        {drawer && drawer !== 'new' && (
          <section className="drawer-section">
            <h3>Estado</h3>
            <Button
              variant={drawer.isActive ? 'danger' : 'secondary'}
              onClick={() => void toggle(drawer)}
            >
              {drawer.isActive ? 'Desactivar equipo' : 'Activar equipo'}
            </Button>
          </section>
        )}
      </FormDrawer>
      {serviceCatalogRepository && (
        <ResourceCapacityPanel
          repository={serviceCatalogRepository}
          eventRepository={repository}
          onMutation={onMutation}
        />
      )}
    </>
  );
}

export function ResourceCalendarPage({
  repository,
  refreshToken,
}: {
  repository: EventRepository;
  refreshToken?: number;
}) {
  const context = useBusinessContext();
  const [view, setView] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(startOfDay(new Date()));
  const [resources, setResources] = useState<Resource[]>([]);
  const [rows, setRows] = useState<ResourceReservationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const from = view === 'day' ? startOfDay(date) : startOfWeek(date);
  const to = addDays(from, view === 'day' ? 1 : 7);
  useEffect(() => {
    Promise.all([
      repository.listResources(context.businessId, true),
      repository.listReservations({
        businessId: context.businessId,
        from: from.toISOString(),
        to: to.toISOString(),
        onlyBlocking: true,
      }),
    ])
      .then(([r, x]) => {
        setResources(r);
        setRows(x);
      })
      .catch((e) => setError(errorText(e)));
  }, [
    repository,
    context.businessId,
    from.toISOString(),
    to.toISOString(),
    refreshToken,
  ]);
  const days = Array.from({ length: view === 'day' ? 1 : 7 }, (_, i) =>
    addDays(from, i),
  );
  const overlaps = (x: ResourceReservationSummary, day: Date) =>
    new Date(x.startsAt) < addDays(day, 1) && new Date(x.endsAt) > day;
  return (
    <>
      <PageHeader title="Disponibilidad" />
      <AgendaBar
        view={view}
        views={[
          { value: 'day', label: 'Día' },
          { value: 'week', label: 'Semana' },
        ]}
        onView={setView}
        period={
          <input
            aria-label="Fecha de disponibilidad"
            type="date"
            value={dateKey(date)}
            onChange={(event) => {
              const [year, month, day] = event.target.value
                .split('-')
                .map(Number);
              if (year && month && day) setDate(new Date(year, month - 1, day));
            }}
          />
        }
        onPrev={() => setDate(addDays(date, view === 'day' ? -1 : -7))}
        onToday={() => setDate(startOfDay(new Date()))}
        onNext={() => setDate(addDays(date, view === 'day' ? 1 : 7))}
      />
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
      <Card className="card--flush">
        {resources.length === 0 ? (
          <EmptyState icon="star" title="Todavía no hay recursos" />
        ) : (
          <div className="matrix-scroll">
            <table className="matrix">
              <thead>
                <tr>
                  <th scope="col">Recurso</th>
                  {days.map((day) => (
                    <th scope="col" key={day.toISOString()}>
                      {day.toLocaleDateString('es-AR', {
                        weekday: 'short',
                        day: '2-digit',
                        month: '2-digit',
                      })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resources.map((resource) => (
                  <tr key={resource.id}>
                    <th scope="row">
                      {resource.name}
                      {!resource.isActive && (
                        <span className="meta block">Inactivo</span>
                      )}
                    </th>
                    {days.map((day) => {
                      const booked = rows.filter(
                        (x) => x.resourceId === resource.id && overlaps(x, day),
                      );
                      return (
                        <td key={day.toISOString()}>
                          {booked.length === 0 ? (
                            <span className="meta">Libre</span>
                          ) : (
                            booked.map((x) => (
                              <div className="resource-booking" key={x.id}>
                                <strong>{x.eventTitle}</strong>
                                <span>
                                  {time(x.startsAt)} → {time(x.endsAt)}
                                </span>
                                <small>{x.customerName}</small>
                              </div>
                            ))
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
