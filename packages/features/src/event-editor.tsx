import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  changeEventStatus,
  createCustomer,
  createEvent,
  searchCustomers,
  updateEvent,
  type CustomerRepository,
  type EventBundle,
  type EventRepository,
  type ServiceCatalogRepository,
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
  type LedPanelReservation,
} from '@centrocolor/domain';
import {
  Button,
  ConfirmDialog,
  InlineMessage,
  Segmented,
  Sheet,
  StatusBadge,
} from '@centrocolor/ui';
import { CustomerField } from './editor-parts';
import { useBusinessContext } from './auth';
import { PaymentAccountPanel } from './payments';
import { EventServiceComposer } from './event-service-composer';
import {} from './resource-capacity';

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

export function EventEditor({
  repository,
  customerRepository,
  serviceCatalogRepository,
  paymentRepository,
  onMutation,
  eventId,
  onClose,
  onSaved,
}: {
  repository: EventRepository;
  customerRepository: CustomerRepository;
  serviceCatalogRepository: ServiceCatalogRepository;
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
  const [ledReservations, setLedReservations] = useState<LedPanelReservation[]>(
    [],
  );
  const formId = useId();
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<'catalog' | 'custom'>('catalog');
  const [custom, setCustom] = useState({
    name: '',
    description: '',
    quantity: '1',
    cents: 0,
  });
  const [availability, setAvailability] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});
  const [confirmCancel, setConfirmCancel] = useState(false);
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
          void serviceCatalogRepository
            .listEventLedReservations(context.businessId, b.event.id)
            .then((rows) => live && setLedReservations(rows))
            .catch((e) => live && setError(errorText(e)));
        }
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [repository, serviceCatalogRepository, context.businessId, eventId]);
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
  async function quickCreate(fullName: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const customer = await createCustomer(
        customerRepository,
        context.businessId,
        {
          fullName,
          phone: null,
          email: null,
          documentNumber: null,
          notes: null,
        },
      );
      setCustomers((x) => [customer, ...x]);
      setCustomerId(customer.id);
      setCustomerQuery(customer.fullName);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function quickStatus(next: EventStatus) {
    if (next === 'cancelled') setConfirmCancel(true);
    else void applyStatus(next);
  }
  async function applyStatus(next: EventStatus) {
    if (!loaded) return;
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
  function addCustomService() {
    const now = new Date().toISOString();
    const quantity = Math.max(1, Number(custom.quantity) || 1);
    setServices((x) => [
      ...x,
      {
        id: crypto.randomUUID(),
        businessId: context.businessId,
        eventId: eventId ?? '',
        sourceServiceId: null,
        name: custom.name,
        description: custom.description || null,
        quantity,
        unitPriceCents: custom.cents,
        totalCents: custom.cents * quantity,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    setCustom({ name: '', description: '', quantity: '1', cents: 0 });
    setAddOpen(false);
  }
  /** Misma consulta que se hace al guardar, pero informativa y sin guardar nada. */
  async function verifyAvailability(item: ReservationDraft) {
    try {
      const normalized = normalizeResourceReservationDetails(item);
      const conflicts = await repository.listReservations({
        businessId: context.businessId,
        resourceId: normalized.resourceId,
        from: normalized.startsAt,
        to: normalized.endsAt,
        excludeReservationId: item.id,
        onlyBlocking: true,
      });
      const c = conflicts[0];
      setAvailability((all) => ({
        ...all,
        [item.id]: c
          ? {
              ok: false,
              text: `No disponible ${time(c.startsAt)} → ${time(c.endsAt)} · reservada para ${c.eventTitle}`,
            }
          : { ok: true, text: 'Disponible en ese horario' },
      }));
    } catch (e) {
      setAvailability((all) => ({
        ...all,
        [item.id]: { ok: false, text: errorText(e) },
      }));
    }
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
      for (const item of ledReservations) {
        const active =
          services.find((x) => x.id === item.eventServiceItemId)?.isActive ??
          item.isActive;
        await serviceCatalogRepository.saveLedPanelReservation({
          ...item,
          eventId: saved.id,
          isActive: active,
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
  const canAddFromCatalog =
    !loaded || ['inquiry', 'quoted'].includes(loaded.event.status);
  const showMore = moreOpen || Boolean(venueName || venueAddress || notes);
  const setService = (index: number, patch: Partial<ServiceDraft>) =>
    setServices((all) =>
      all.map((x, i) => (i === index ? { ...x, ...patch } : x)),
    );
  const setReservation = (index: number, patch: Partial<ReservationDraft>) =>
    setReservations((all) =>
      all.map((x, i) => (i === index ? { ...x, ...patch } : x)),
    );
  const isTravel = (item: ServiceDraft) =>
    Boolean(
      item.configSnapshot && 'parentServiceItemId' in item.configSnapshot,
    );

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        size="lg"
        variant="side"
        title={
          eventId ? 'Presupuesto o reserva' : 'Nuevo presupuesto o reserva'
        }
        footer={
          <>
            <div className="sheet-foot__start event-summary" aria-live="polite">
              <span>
                Servicios <strong>{money(serviceSubtotal)}</strong>
              </span>
              <span>
                Recursos <strong>{money(resourceSubtotal)}</strong>
              </span>
              <span className="event-summary__total">
                Total{' '}
                <strong>{money(serviceSubtotal + resourceSubtotal)}</strong>
              </span>
            </div>
            <Button variant="ghost" onClick={onClose}>
              Volver
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={formId}
              disabled={busy}
            >
              {busy ? 'Guardando…' : 'Guardar'}
            </Button>
          </>
        }
      >
        {error && <InlineMessage tone="error">{error}</InlineMessage>}
        <form
          id={formId}
          className="editor-form"
          onSubmit={(e) => void save(e)}
        >
          <section className="editor-grid" aria-label="Datos principales">
            <div className="span-12">
              <CustomerField
                customers={customers}
                query={customerQuery}
                onQuery={setCustomerQuery}
                value={customerId}
                onChange={setCustomerId}
                onQuickCreate={quickCreate}
                busy={busy}
              />
            </div>
            <label className="span-6">
              Título *
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="span-6">
              Tipo
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
              >
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
            <label className="span-4 half">
              Inicio *
              <input
                required
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label className="span-4 half">
              Fin *
              <input
                required
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </label>
            <label className="span-4">
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
            {!showMore && (
              <div className="editor-grid__more span-4">
                <Button
                  variant="ghost"
                  size="sm"
                  icon="plus"
                  onClick={() => setMoreOpen(true)}
                >
                  Lugar y notas
                </Button>
              </div>
            )}
            {showMore && (
              <>
                <label className="span-4">
                  Lugar
                  <input
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                  />
                </label>
                <label className="span-4">
                  Dirección
                  <input
                    value={venueAddress}
                    onChange={(e) => setVenueAddress(e.target.value)}
                  />
                </label>
                <label className="span-4">
                  Notas
                  <textarea
                    rows={1}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </label>
              </>
            )}
          </section>

          <section className="editor-block editor-block--service">
            <div className="section-head">
              <div>
                <h3>Servicios contratados</h3>
                <p className="meta">Lo que se vende y se cobra al cliente.</p>
              </div>
              <Button
                variant="secondary"
                icon="plus"
                onClick={() => setAddOpen(true)}
              >
                Agregar servicio
              </Button>
            </div>
            {services.length === 0 ? (
              <p className="meta price-empty">
                Todavía no hay servicios. Agregá el primero.
              </p>
            ) : (
              <div className="editor-lines">
                <div className="editor-line editor-line--service editor-line--head">
                  <span>Servicio</span>
                  <span>Detalle</span>
                  <span>Cant.</span>
                  <span>Precio unitario</span>
                  <span>Total</span>
                  <span />
                </div>
                {services.map((item, index) => (
                  <div
                    className={`editor-line editor-line--service ${isTravel(item) ? 'is-travel' : ''} ${!item.isActive ? 'inactive' : ''}`.trim()}
                    key={item.id}
                  >
                    <div className="editor-line__name">
                      {isTravel(item) && (
                        <StatusBadge tone="info">Viáticos</StatusBadge>
                      )}
                      <input
                        aria-label="Servicio"
                        value={item.name}
                        disabled={!item.isActive}
                        placeholder="Fotografía"
                        onChange={(e) =>
                          setService(index, { name: e.target.value })
                        }
                      />
                    </div>
                    <input
                      aria-label="Descripción del servicio"
                      value={item.description ?? ''}
                      disabled={!item.isActive}
                      placeholder="Detalle"
                      onChange={(e) =>
                        setService(index, {
                          description: e.target.value || null,
                        })
                      }
                    />
                    <input
                      aria-label="Cantidad"
                      type="number"
                      min="1"
                      value={item.quantity}
                      disabled={!item.isActive}
                      onChange={(e) =>
                        setService(index, { quantity: Number(e.target.value) })
                      }
                    />
                    <MoneyInput
                      label="Precio unitario"
                      cents={item.unitPriceCents}
                      disabled={!item.isActive}
                      onCents={(cents) =>
                        setService(index, {
                          unitPriceCents: cents,
                          totalCents: cents * item.quantity,
                        })
                      }
                    />
                    <strong className="editor-line__total">
                      {money(item.quantity * item.unitPriceCents)}
                    </strong>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setService(index, { isActive: !item.isActive })
                      }
                    >
                      {item.isActive ? 'Quitar' : 'Restaurar'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="editor-block editor-block--resource">
            <div className="section-head">
              <div>
                <h3>Recursos reservados</h3>
                <p className="meta">
                  Equipamiento físico. La disponibilidad se verifica al guardar
                  como Reservado o Realizado.
                </p>
              </div>
              <Button variant="secondary" icon="plus" onClick={addReservation}>
                Reservar recurso
              </Button>
            </div>
            {reservations.length === 0 ? (
              <p className="meta price-empty">
                Sin recursos. Se suman solos al cotizar un servicio del
                catálogo.
              </p>
            ) : (
              <div className="editor-lines">
                {reservations.map((item, index) => {
                  const check = availability[item.id];
                  return (
                    <div
                      className={`editor-line editor-line--resource ${!item.isActive ? 'inactive' : ''}`.trim()}
                      key={item.id}
                    >
                      <label className="editor-mini span-5">
                        Recurso
                        <select
                          value={item.resourceId}
                          disabled={!item.isActive}
                          onChange={(e) => {
                            const selected = resources.find(
                              (r) => r.id === e.target.value,
                            );
                            setReservation(index, {
                              resourceId: e.target.value,
                              priceCents: selected?.defaultPriceCents ?? 0,
                            });
                          }}
                        >
                          <option value="">Seleccionar recurso…</option>
                          {resources
                            .filter(
                              (x) => x.isActive || x.id === item.resourceId,
                            )
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="editor-mini span-3">
                        Precio
                        <MoneyInput
                          key={`price-${item.id}-${item.resourceId}`}
                          label="Precio recurso"
                          cents={item.priceCents}
                          disabled={!item.isActive}
                          onCents={(cents) =>
                            setReservation(index, { priceCents: cents })
                          }
                        />
                      </label>
                      <div className="editor-line__actions span-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!item.isActive || !item.resourceId}
                          onClick={() => void verifyAvailability(item)}
                        >
                          Verificar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setReservation(index, { isActive: !item.isActive })
                          }
                        >
                          {item.isActive ? 'Quitar' : 'Restaurar'}
                        </Button>
                      </div>
                      <label className="editor-mini span-4">
                        Inicio
                        <input
                          type="datetime-local"
                          value={localInput(item.startsAt)}
                          disabled={!item.isActive}
                          onChange={(e) =>
                            setReservation(index, {
                              startsAt: new Date(e.target.value).toISOString(),
                            })
                          }
                        />
                      </label>
                      <label className="editor-mini span-4">
                        Fin
                        <input
                          type="datetime-local"
                          value={localInput(item.endsAt)}
                          disabled={!item.isActive}
                          onChange={(e) =>
                            setReservation(index, {
                              endsAt: new Date(e.target.value).toISOString(),
                            })
                          }
                        />
                      </label>
                      <label className="editor-mini span-4">
                        Notas
                        <input
                          value={item.notes ?? ''}
                          disabled={!item.isActive}
                          onChange={(e) =>
                            setReservation(index, {
                              notes: e.target.value || null,
                            })
                          }
                        />
                      </label>
                      {check && (
                        <span
                          className={`editor-line__check span-12 ${check.ok ? 'txt-ok' : 'txt-alert'}`}
                        >
                          {check.text}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
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
            <div className="editor-state-actions">
              {loaded.event.status === 'inquiry' && (
                <Button
                  disabled={busy}
                  onClick={() => void quickStatus('quoted')}
                >
                  Pasar a presupuestado
                </Button>
              )}
              {loaded.event.status === 'quoted' && (
                <Button
                  disabled={busy}
                  onClick={() => void quickStatus('reserved')}
                >
                  Confirmar reserva
                </Button>
              )}
              {loaded.event.status === 'reserved' && (
                <Button
                  disabled={busy}
                  onClick={() => void quickStatus('completed')}
                >
                  Marcar realizado
                </Button>
              )}
              {loaded.event.status !== 'cancelled' && (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => void quickStatus('cancelled')}
                >
                  Cancelar presupuesto o reserva
                </Button>
              )}
            </div>
          </>
        )}
      </Sheet>

      <Sheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        variant="side"
        title="Agregar servicio"
      >
        {canAddFromCatalog && (
          <Segmented
            label="Origen del servicio"
            value={addMode}
            options={[
              { value: 'catalog', label: 'Del catálogo' },
              { value: 'custom', label: 'Personalizado' },
            ]}
            onChange={setAddMode}
          />
        )}
        {canAddFromCatalog && addMode === 'catalog' ? (
          <EventServiceComposer
            catalog={serviceCatalogRepository}
            eventRepository={repository}
            customerRepository={customerRepository}
            customerId={customerId}
            startsAt={startsAt}
            endsAt={endsAt}
            currentServices={services}
            currentReservations={reservations}
            currentLed={ledReservations}
            onAdd={(service, travel, resourceRows, led) => {
              setServices((all) => [
                ...all,
                service,
                ...(travel ? [travel] : []),
              ]);
              setReservations((all) => [...all, ...resourceRows]);
              if (led) setLedReservations((all) => [...all, led]);
              setAddOpen(false);
            }}
          />
        ) : (
          <form
            className="form-drawer"
            onSubmit={(e) => {
              e.preventDefault();
              addCustomService();
            }}
          >
            <label>
              Servicio *
              <input
                required
                value={custom.name}
                placeholder="Fotografía"
                onChange={(e) => setCustom({ ...custom, name: e.target.value })}
              />
            </label>
            <label>
              Detalle
              <input
                value={custom.description}
                onChange={(e) =>
                  setCustom({ ...custom, description: e.target.value })
                }
              />
            </label>
            <div className="config-editor-form__grid">
              <label>
                Cantidad
                <input
                  type="number"
                  min="1"
                  value={custom.quantity}
                  onChange={(e) =>
                    setCustom({ ...custom, quantity: e.target.value })
                  }
                />
              </label>
              <label>
                Precio unitario
                <MoneyInput
                  label="Precio unitario del servicio"
                  cents={custom.cents}
                  disabled={false}
                  onCents={(cents) => setCustom({ ...custom, cents })}
                />
              </label>
            </div>
            <Button
              variant="primary"
              type="submit"
              disabled={!custom.name.trim()}
            >
              Agregar al presupuesto
            </Button>
          </form>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar presupuesto o reserva"
        destructive
        confirmLabel="Cancelar presupuesto o reserva"
        cancelLabel="Volver"
        busy={busy}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          return applyStatus('cancelled');
        }}
      >
        Los recursos dejarán de bloquear disponibilidad.
      </ConfirmDialog>
    </>
  );
}
