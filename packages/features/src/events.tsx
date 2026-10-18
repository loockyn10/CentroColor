import { useEffect, useState, type FormEvent } from 'react';
import {
  changeEventStatus,
  createCustomer,
  createEvent,
  createEventType,
  createResource,
  searchCustomers,
  updateEvent,
  updateEventType,
  updateResource,
  type CustomerRepository,
  type EventBundle,
  type EventRepository,
  type EventSummary,
  type ResourceReservationSummary,
  type WorkPaymentRepository,
} from '@centrocolor/application';
import {
  eventStatuses,
  normalizeEventServiceItemDetails,
  normalizeResourceReservationDetails,
  type Customer,
  type Event,
  type EventServiceItem,
  type EventStatus,
  type EventType,
  type Resource,
  type ResourceReservation,
} from '@centrocolor/domain';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  PageHeader,
  Segmented,
} from '@centrocolor/ui';
import { useBusinessContext } from './auth';
import { PaymentAccountPanel } from './payments';

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
const localInput = (iso: string | Date) => {
  const d = iso instanceof Date ? iso : new Date(iso);
  return `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
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
const parseMoney = (value: string) => {
  const clean = value.trim();
  const normalized = clean.includes(',')
    ? clean.replace(/\./g, '').replace(',', '.')
    : clean;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0)
    throw new Error('Ingresá un precio válido.');
  return Math.round(number * 100);
};
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  });
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Ocurrió un error. Reintentá.';

type ServiceDraft = EventServiceItem;
type ReservationDraft = ResourceReservation;

function MoneyInput({
  label,
  cents,
  disabled,
  onCents,
}: {
  label: string;
  cents: number;
  disabled: boolean;
  onCents: (cents: number) => void;
}) {
  const [value, setValue] = useState((cents / 100).toFixed(2));
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={value}
      disabled={disabled}
      onChange={(event) => {
        setValue(event.target.value);
        try {
          onCents(parseMoney(event.target.value));
        } catch {
          /* Preserve an incomplete decimal while the user keeps typing. */
        }
      }}
      onBlur={() => {
        try {
          const parsed = parseMoney(value);
          onCents(parsed);
          setValue((parsed / 100).toFixed(2));
        } catch {
          setValue((cents / 100).toFixed(2));
        }
      }}
    />
  );
}

function EventEditor({
  repository,
  customerRepository,
  paymentRepository,
  onMutation,
  eventId,
  onClose,
  onSaved,
}: {
  repository: EventRepository;
  customerRepository: CustomerRepository;
  paymentRepository: WorkPaymentRepository;
  onMutation?: () => void;
  eventId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const context = useBusinessContext();
  const initialStart = new Date(Date.now() + 24 * 60 * 60_000);
  initialStart.setHours(20, 0, 0, 0);
  const [loaded, setLoaded] = useState<EventBundle | null>(null);
  const [types, setTypes] = useState<EventType[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState(localInput(initialStart));
  const [endsAt, setEndsAt] = useState(
    localInput(new Date(initialStart.getTime() + 4 * 60 * 60 * 1000)),
  );
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<EventStatus>('inquiry');
  const [services, setServices] = useState<ServiceDraft[]>([]);
  const [reservations, setReservations] = useState<ReservationDraft[]>([]);
  const [quickName, setQuickName] = useState('');
  const [showQuick, setShowQuick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      repository.listTypes(context.businessId, true),
      repository.listResources(context.businessId, true),
      eventId
        ? repository.getEventBundle(context.businessId, eventId)
        : Promise.resolve(null),
    ])
      .then(([t, r, b]) => {
        if (!live) return;
        setTypes(t);
        setResources(r);
        if (b) {
          setLoaded(b);
          setCustomerId(b.event.customerId);
          setCustomerQuery(b.event.customerName);
          setTypeId(b.event.eventTypeId ?? '');
          setTitle(b.event.title);
          setStartsAt(localInput(b.event.startsAt));
          setEndsAt(localInput(b.event.endsAt));
          setVenueName(b.event.venueName ?? '');
          setVenueAddress(b.event.venueAddress ?? '');
          setNotes(b.event.notes ?? '');
          setStatus(b.event.status);
          setServices(b.services);
          setReservations(b.reservations);
        }
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [repository, context.businessId, eventId]);
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void searchCustomers(
        customerRepository,
        context.businessId,
        customerQuery,
      )
        .then(
          (rows) =>
            live &&
            setCustomers(rows.filter((x) => x.isActive || x.id === customerId)),
        )
        .catch((e) => live && setError(errorText(e)));
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [customerRepository, context.businessId, customerQuery, customerId]);
  async function quickCreate() {
    setBusy(true);
    setError(null);
    try {
      const customer = await createCustomer(
        customerRepository,
        context.businessId,
        {
          fullName: quickName,
          phone: null,
          email: null,
          documentNumber: null,
          notes: null,
        },
      );
      setCustomers((x) => [customer, ...x]);
      setCustomerId(customer.id);
      setCustomerQuery(customer.fullName);
      setQuickName('');
      setShowQuick(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function quickStatus(next: EventStatus) {
    if (!loaded) return;
    if (
      next === 'cancelled' &&
      !window.confirm(
        '¿Cancelar este evento? Las reservas futuras dejarán de bloquear disponibilidad.',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await changeEventStatus(
        repository,
        context.businessId,
        loaded.event.id,
        next,
      );
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function addService() {
    const now = new Date().toISOString();
    setServices((x) => [
      ...x,
      {
        id: crypto.randomUUID(),
        businessId: context.businessId,
        eventId: eventId ?? '',
        sourceServiceId: null,
        name: '',
        description: null,
        quantity: 1,
        unitPriceCents: 0,
        totalCents: 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  }
  function addReservation() {
    const now = new Date().toISOString();
    setReservations((x) => [
      ...x,
      {
        id: crypto.randomUUID(),
        businessId: context.businessId,
        eventId: eventId ?? '',
        resourceId: '',
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        priceCents: 0,
        notes: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  }
  async function save(form: FormEvent) {
    form.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const details = {
        customerId,
        eventTypeId: typeId || null,
        title,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        venueName: venueName || null,
        venueAddress: venueAddress || null,
        notes: notes || null,
      };
      for (const item of reservations.filter(
        (x) => x.isActive && x.resourceId,
      )) {
        const normalized = normalizeResourceReservationDetails(item);
        if (['reserved', 'completed'].includes(status)) {
          const conflicts = await repository.listReservations({
            businessId: context.businessId,
            resourceId: normalized.resourceId,
            from: normalized.startsAt,
            to: normalized.endsAt,
            excludeReservationId: item.id,
            onlyBlocking: true,
          });
          if (conflicts.length) {
            const c = conflicts[0];
            throw new Error(
              `${c.resourceName} no disponible ${time(c.startsAt)} → ${time(c.endsAt)}. Reservada para: ${c.eventTitle}.`,
            );
          }
        }
      }
      let saved: Event;
      if (loaded)
        saved = await updateEvent(
          repository,
          context.businessId,
          loaded.event.id,
          details,
        );
      else
        saved = await createEvent(
          repository,
          {
            businessId: context.businessId,
            branchId: context.branchId!,
            userId: context.userId,
          },
          details,
        );
      for (const item of services) {
        if (!item.isActive && !loaded?.services.some((x) => x.id === item.id))
          continue;
        const normalized = normalizeEventServiceItemDetails(item);
        await repository.upsertServiceItem({
          ...item,
          ...normalized,
          eventId: saved.id,
          businessId: context.businessId,
          updatedAt: new Date().toISOString(),
        });
      }
      for (const item of reservations) {
        const normalized = item.resourceId
          ? normalizeResourceReservationDetails(item)
          : null;
        if (normalized)
          await repository.upsertReservation({
            ...item,
            ...normalized,
            eventId: saved.id,
            businessId: context.businessId,
            updatedAt: new Date().toISOString(),
          });
      }
      if (saved.status !== status)
        await changeEventStatus(
          repository,
          context.businessId,
          saved.id,
          status,
        );
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const serviceSubtotal = services
    .filter((x) => x.isActive)
    .reduce((s, x) => s + x.quantity * x.unitPriceCents, 0);
  const resourceSubtotal = reservations
    .filter((x) => x.isActive)
    .reduce((s, x) => s + x.priceCents, 0);
  return (
    <div className="event-editor-backdrop">
      <Card className="event-editor">
        <div className="appointment-editor-heading">
          <div>
            <small>EVENTOS · {context.branchName}</small>
            <h2>{eventId ? 'Ficha de evento' : 'Crear evento'}</h2>
          </div>
          <button type="button" onClick={onClose}>
            ✕
          </button>
        </div>
        {error && (
          <p className="appointment-error" role="alert">
            {error}
          </p>
        )}
        <form className="event-form" onSubmit={(e) => void save(e)}>
          <label className="event-wide">
            Buscar cliente
            <input
              type="search"
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              placeholder="Nombre, teléfono, email o documento"
            />
          </label>
          <label className="event-wide">
            Cliente *
            <select
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {customers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.fullName}
                </option>
              ))}
            </select>
          </label>
          <div className="event-wide quick-customer">
            <button type="button" onClick={() => setShowQuick(!showQuick)}>
              + Crear cliente
            </button>
            {showQuick && (
              <div>
                <input
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  placeholder="Nombre completo"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void quickCreate()}
                >
                  Crear y seleccionar
                </button>
              </div>
            )}
          </div>
          <label>
            Tipo
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Sin tipo</option>
              {types
                .filter((x) => x.isActive || x.id === typeId)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Título *
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Inicio *
            <input
              required
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </label>
          <label>
            Fin *
            <input
              required
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </label>
          <label>
            Lugar
            <input
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
            />
          </label>
          <label>
            Dirección
            <input
              value={venueAddress}
              onChange={(e) => setVenueAddress(e.target.value)}
            />
          </label>
          <label>
            Estado
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as EventStatus)}
            >
              {eventStatuses.map((x) => (
                <option key={x} value={x}>
                  {statusLabels[x]}
                </option>
              ))}
            </select>
          </label>
          <label className="event-wide">
            Notas
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <section className="event-wide event-lines">
            <div className="event-section-heading">
              <h3>Servicios contratados</h3>
              <button type="button" onClick={addService}>
                + Agregar servicio
              </button>
            </div>
            {services.map((item, index) => (
              <div
                className={`event-line ${!item.isActive ? 'inactive' : ''}`}
                key={item.id}
              >
                <input
                  aria-label="Servicio"
                  value={item.name}
                  disabled={!item.isActive}
                  placeholder="Fotografía"
                  onChange={(e) =>
                    setServices((all) =>
                      all.map((x, i) =>
                        i === index ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  aria-label="Descripción del servicio"
                  value={item.description ?? ''}
                  disabled={!item.isActive}
                  placeholder="Descripción"
                  onChange={(e) =>
                    setServices((all) =>
                      all.map((x, i) =>
                        i === index
                          ? { ...x, description: e.target.value || null }
                          : x,
                      ),
                    )
                  }
                />
                <input
                  aria-label="Cantidad"
                  type="number"
                  min="1"
                  value={item.quantity}
                  disabled={!item.isActive}
                  onChange={(e) =>
                    setServices((all) =>
                      all.map((x, i) =>
                        i === index
                          ? { ...x, quantity: Number(e.target.value) }
                          : x,
                      ),
                    )
                  }
                />
                <MoneyInput
                  label="Precio unitario"
                  cents={item.unitPriceCents}
                  disabled={!item.isActive}
                  onCents={(cents) => {
                    setServices((all) =>
                      all.map((x, i) =>
                        i === index
                          ? {
                              ...x,
                              unitPriceCents: cents,
                              totalCents: cents * x.quantity,
                            }
                          : x,
                      ),
                    );
                  }}
                />
                <strong>{money(item.quantity * item.unitPriceCents)}</strong>
                <button
                  type="button"
                  onClick={() =>
                    setServices((all) =>
                      all.map((x, i) =>
                        i === index ? { ...x, isActive: !x.isActive } : x,
                      ),
                    )
                  }
                >
                  {item.isActive ? 'Quitar' : 'Restaurar'}
                </button>
              </div>
            ))}
          </section>
          <section className="event-wide event-lines">
            <div className="event-section-heading">
              <h3>Recursos</h3>
              <button type="button" onClick={addReservation}>
                + Reservar recurso
              </button>
            </div>
            {reservations.map((item, index) => (
              <div
                className={`event-line resource-line ${!item.isActive ? 'inactive' : ''}`}
                key={item.id}
              >
                <select
                  aria-label="Recurso"
                  value={item.resourceId}
                  disabled={!item.isActive}
                  onChange={(e) => {
                    const selected = resources.find(
                      (r) => r.id === e.target.value,
                    );
                    setReservations((all) =>
                      all.map((x, i) =>
                        i === index
                          ? {
                              ...x,
                              resourceId: e.target.value,
                              priceCents: selected?.defaultPriceCents ?? 0,
                            }
                          : x,
                      ),
                    );
                  }}
                >
                  <option value="">Seleccionar recurso…</option>
                  {resources
                    .filter((x) => x.isActive || x.id === item.resourceId)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
                <input
                  aria-label="Inicio de reserva"
                  type="datetime-local"
                  value={localInput(item.startsAt)}
                  disabled={!item.isActive}
                  onChange={(e) =>
                    setReservations((all) =>
                      all.map((x, i) =>
                        i === index
                          ? {
                              ...x,
                              startsAt: new Date(e.target.value).toISOString(),
                            }
                          : x,
                      ),
                    )
                  }
                />
                <input
                  aria-label="Fin de reserva"
                  type="datetime-local"
                  value={localInput(item.endsAt)}
                  disabled={!item.isActive}
                  onChange={(e) =>
                    setReservations((all) =>
                      all.map((x, i) =>
                        i === index
                          ? {
                              ...x,
                              endsAt: new Date(e.target.value).toISOString(),
                            }
                          : x,
                      ),
                    )
                  }
                />
                <MoneyInput
                  key={`price-${item.id}-${item.resourceId}`}
                  label="Precio recurso"
                  cents={item.priceCents}
                  disabled={!item.isActive}
                  onCents={(cents) => {
                    setReservations((all) =>
                      all.map((x, i) =>
                        i === index ? { ...x, priceCents: cents } : x,
                      ),
                    );
                  }}
                />
                <input
                  aria-label="Notas del recurso"
                  value={item.notes ?? ''}
                  disabled={!item.isActive}
                  placeholder="Notas"
                  onChange={(e) =>
                    setReservations((all) =>
                      all.map((x, i) =>
                        i === index
                          ? { ...x, notes: e.target.value || null }
                          : x,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setReservations((all) =>
                      all.map((x, i) =>
                        i === index ? { ...x, isActive: !x.isActive } : x,
                      ),
                    )
                  }
                >
                  {item.isActive ? 'Quitar' : 'Restaurar'}
                </button>
              </div>
            ))}
          </section>
          <div className="event-wide event-totals">
            <span>
              Subtotal servicios <strong>{money(serviceSubtotal)}</strong>
            </span>
            <span>
              Subtotal recursos <strong>{money(resourceSubtotal)}</strong>
            </span>
            <span>
              Total evento{' '}
              <strong>{money(serviceSubtotal + resourceSubtotal)}</strong>
            </span>
          </div>
          <div className="event-wide appointment-editor-actions">
            <button className="customer-primary" disabled={busy} type="submit">
              {busy ? 'Guardando…' : 'Guardar evento'}
            </button>
            <button type="button" onClick={onClose}>
              Volver
            </button>
          </div>
        </form>
        {loaded && (
          <>
            <PaymentAccountPanel
              repository={paymentRepository}
              sourceType="event"
              sourceId={loaded.event.id}
              onMutation={onMutation}
            />
            <div className="event-contact">
              <strong>Contacto</strong>
              <span>{loaded.event.customerName}</span>
              <span>{loaded.event.customerPhone || 'Sin teléfono'}</span>
              <span>{loaded.event.customerEmail || 'Sin email'}</span>
            </div>
            <div className="appointment-state-actions">
              {loaded.event.status === 'inquiry' && (
                <button
                  disabled={busy}
                  onClick={() => void quickStatus('quoted')}
                >
                  Pasar a presupuestado
                </button>
              )}
              {loaded.event.status === 'quoted' && (
                <button
                  disabled={busy}
                  onClick={() => void quickStatus('reserved')}
                >
                  Confirmar reserva
                </button>
              )}
              {loaded.event.status === 'reserved' && (
                <button
                  disabled={busy}
                  onClick={() => void quickStatus('completed')}
                >
                  Marcar realizado
                </button>
              )}
              {loaded.event.status !== 'cancelled' && (
                <button
                  className="danger-action"
                  disabled={busy}
                  onClick={() => void quickStatus('cancelled')}
                >
                  Cancelar evento
                </button>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function EventTypesManager({
  repository,
  onMutation,
}: {
  repository: EventRepository;
  onMutation?: () => void;
}) {
  const context = useBusinessContext();
  const canManage = ['owner', 'admin'].includes(context.role);
  const [types, setTypes] = useState<EventType[]>([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<EventType | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void repository
      .listTypes(context.businessId, true)
      .then(setTypes)
      .catch((e) => setError(errorText(e)));
  }, [repository, context.businessId, refresh]);
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      if (editing)
        await updateEventType(repository, context.businessId, editing.id, {
          name,
        });
      else await createEventType(repository, context.businessId, { name });
      setName('');
      setEditing(null);
      setRefresh((x) => x + 1);
      onMutation?.();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <Card className="event-config-card">
      <h2>Tipos de evento</h2>
      {error && <p role="alert">{error}</p>}
      {canManage && (
        <form onSubmit={(e) => void save(e)}>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del tipo"
          />
          <button className="customer-primary">
            {editing ? 'Guardar' : 'Crear tipo'}
          </button>
        </form>
      )}
      {types.map((x) => (
        <div className="event-config-row" key={x.id}>
          <strong>{x.name}</strong>
          <span>{x.isActive ? 'Activo' : 'Inactivo'}</span>
          {canManage && (
            <>
              <button
                onClick={() => {
                  setEditing(x);
                  setName(x.name);
                }}
              >
                Editar
              </button>
              <button
                onClick={() =>
                  void repository
                    .setTypeActive(context.businessId, x.id, !x.isActive)
                    .then(() => {
                      setRefresh((n) => n + 1);
                      onMutation?.();
                    })
                    .catch((e) => setError(errorText(e)))
                }
              >
                {x.isActive ? 'Desactivar' : 'Activar'}
              </button>
            </>
          )}
        </div>
      ))}
    </Card>
  );
}

export function EventsPage({
  repository,
  customerRepository,
  paymentRepository,
  refreshToken,
  onMutation,
}: {
  repository: EventRepository;
  customerRepository: CustomerRepository;
  paymentRepository: WorkPaymentRepository;
  refreshToken?: number;
  onMutation?: () => void;
}) {
  const context = useBusinessContext();
  const [mode, setMode] = useState<'events' | 'types'>('events');
  const [layout, setLayout] = useState<'board' | 'list'>('board');
  const [filter, setFilter] = useState<'upcoming' | EventStatus>('upcoming');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<EventSummary[]>([]);
  const [editor, setEditor] = useState<string | true | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== 'events') return;
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
    mode,
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
        <span className="state-line">
          <span className={x.status === 'reserved' ? 'tone-ok' : undefined}>
            {statusLabels[x.status]}
          </span>
        </span>
      )}
    </button>
  );
  return (
    <>
      <PageHeader
        title="Eventos"
        actions={
          mode === 'events' ? (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => setEditor(true)}
            >
              Crear evento
            </Button>
          ) : undefined
        }
      />
      <div className="events-toolbar">
        <Segmented
          label="Sección"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'events', label: 'Eventos' },
            { value: 'types', label: 'Tipos' },
          ]}
        />
        {mode === 'events' && (
          <>
            <div className="search-field">
              <Icon name="search" />
              <input
                type="search"
                aria-label="Buscar eventos"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cliente, título o lugar"
              />
            </div>
            <div className="chips" role="group" aria-label="Filtrar eventos">
              <button
                type="button"
                className="chip"
                aria-pressed={filter === 'upcoming'}
                onClick={() => setFilter('upcoming')}
              >
                Próximos
              </button>
              {eventStatuses.map((x) => (
                <button
                  key={x}
                  type="button"
                  className="chip"
                  aria-pressed={filter === x}
                  onClick={() => setFilter(x)}
                >
                  {statusLabels[x]}
                </button>
              ))}
            </div>
            {filter === 'upcoming' && (
              <Segmented
                label="Vista"
                value={layout}
                onChange={setLayout}
                options={[
                  { value: 'board', label: 'Tablero' },
                  { value: 'list', label: 'Lista' },
                ]}
              />
            )}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="appointment-error">
          {error}
        </p>
      )}
      {mode === 'types' ? (
        <EventTypesManager repository={repository} onMutation={onMutation} />
      ) : asBoard ? (
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
                  <p className="meta pad">Sin eventos.</p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <Card className="card--flush">
          {rows.length === 0 ? (
            <EmptyState icon="star" title="No hay eventos para este filtro" />
          ) : (
            <div className="rows">{rows.map(card)}</div>
          )}
        </Card>
      )}
      {editor && (
        <EventEditor
          repository={repository}
          customerRepository={customerRepository}
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
  refreshToken,
  onMutation,
}: {
  repository: EventRepository;
  refreshToken?: number;
  onMutation?: () => void;
}) {
  const context = useBusinessContext();
  const canManage = ['owner', 'admin'].includes(context.role);
  const [rows, setRows] = useState<Resource[]>([]);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0,00');
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void repository
      .listResources(context.businessId, true)
      .then(setRows)
      .catch((e) => setError(errorText(e)));
  }, [repository, context.businessId, refresh, refreshToken]);
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const details = {
        name,
        description: description || null,
        defaultPriceCents: price.trim() ? parseMoney(price) : null,
      };
      if (editing)
        await updateResource(
          repository,
          context.businessId,
          editing.id,
          details,
        );
      else await createResource(repository, context.businessId, details);
      setEditing(null);
      setName('');
      setDescription('');
      setPrice('0,00');
      setRefresh((x) => x + 1);
      onMutation?.();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <>
      <PageHeader title="Recursos" />
      {error && (
        <p role="alert" className="appointment-error">
          {error}
        </p>
      )}
      {canManage && (
        <Card className="resource-form">
          <form onSubmit={(e) => void save(e)}>
            <label>
              Nombre
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Descripción
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label>
              Precio predeterminado
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            <button className="customer-primary">
              {editing ? 'Guardar cambios' : 'Crear recurso'}
            </button>
          </form>
        </Card>
      )}
      <Card className="resource-list">
        {rows.map((x) => (
          <div className="event-config-row" key={x.id}>
            <strong>{x.name}</strong>
            <span>
              {x.defaultPriceCents === null
                ? 'Sin precio'
                : money(x.defaultPriceCents)}
            </span>
            <span>{x.isActive ? 'Activo' : 'Inactivo'}</span>
            {canManage && (
              <>
                <button
                  onClick={() => {
                    setEditing(x);
                    setName(x.name);
                    setDescription(x.description ?? '');
                    setPrice(
                      x.defaultPriceCents === null
                        ? ''
                        : (x.defaultPriceCents / 100).toFixed(2),
                    );
                  }}
                >
                  Editar
                </button>
                <button
                  onClick={() =>
                    void repository
                      .setResourceActive(context.businessId, x.id, !x.isActive)
                      .then(() => {
                        setRefresh((n) => n + 1);
                        onMutation?.();
                      })
                      .catch((e) => setError(errorText(e)))
                  }
                >
                  {x.isActive ? 'Desactivar' : 'Activar'}
                </button>
              </>
            )}
          </div>
        ))}
      </Card>
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
      <PageHeader title="Disponibilidad de recursos" />
      <div className="agenda-toolbar">
        <Segmented
          label="Vista"
          value={view}
          onChange={setView}
          options={[
            { value: 'day', label: 'Día' },
            { value: 'week', label: 'Semana' },
          ]}
        />
        <Button
          icon="chevL"
          onClick={() => setDate(addDays(date, view === 'day' ? -1 : -7))}
        >
          Anterior
        </Button>
        <Button onClick={() => setDate(startOfDay(new Date()))}>Hoy</Button>
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
        <Button
          iconAfter="chevR"
          onClick={() => setDate(addDays(date, view === 'day' ? 1 : 7))}
        >
          Siguiente
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
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
