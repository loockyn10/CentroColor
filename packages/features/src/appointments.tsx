import { useEffect, useMemo, useState } from 'react';
import {
  changeAppointmentStatus,
  createAppointment,
  createAppointmentType,
  createCustomer,
  searchCustomers,
  updateAppointment,
  updateAppointmentType,
  type AppointmentRepository,
  type AppointmentSummary,
  type CustomerRepository,
} from '@centrocolor/application';
import {
  appointmentStatuses,
  type Appointment,
  type AppointmentStatus,
  type AppointmentType,
  type Customer,
} from '@centrocolor/domain';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FilterBar,
  FormDrawer,
  InlineMessage,
  PageHeader,
  StatusBadge,
  takeCreateIntent,
} from '@centrocolor/ui';
import { AgendaBar, CustomerField } from './editor-parts';
import { CatalogRow, CatalogSection } from './configuration-ui';
import { appointmentStatus, statusMeta } from './status';
import { useBusinessContext } from './auth';

const statusLabels: Record<AppointmentStatus, string> = {
  scheduled: 'Programado',
  completed: 'Completado',
  cancelled: 'Cancelado',
  no_show: 'Ausente',
};
const pad = (value: number) => String(value).padStart(2, '0');
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
function localInput(date: Date) {
  return `${dateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}
function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
function startOfWeek(date: Date) {
  const result = startOfDay(date);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Ocurrió un error. Reintentá.';
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  });
const shortDate = (date: Date) =>
  date.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

function AppointmentCard({
  item,
  onOpen,
}: {
  item: AppointmentSummary;
  onOpen: (item: AppointmentSummary) => void;
}) {
  return (
    <button
      type="button"
      className={`appointment-card status-${item.status}`}
      onClick={() => onOpen(item)}
    >
      <span className="appointment-time">
        {time(item.startsAt)}–{time(item.endsAt)}
      </span>
      <strong>{item.title}</strong>
      <span>{item.customerName}</span>
      {item.status !== 'scheduled' && (
        <StatusBadge tone={statusMeta(appointmentStatus, item.status).tone}>
          {statusLabels[item.status]}
        </StatusBadge>
      )}
    </button>
  );
}

function AppointmentEditor({
  repository,
  customerRepository,
  appointment,
  initialStart,
  onClose,
  onSaved,
}: {
  repository: AppointmentRepository;
  customerRepository: CustomerRepository;
  appointment?: Appointment | null;
  initialStart?: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const context = useBusinessContext();
  const start = appointment
    ? new Date(appointment.startsAt)
    : (initialStart ?? new Date(Date.now() + 60 * 60_000));
  start.setSeconds(0, 0);
  const defaultEnd = appointment
    ? new Date(appointment.endsAt)
    : new Date(start.getTime() + 60 * 60_000);
  const [startsAt, setStartsAt] = useState(localInput(start));
  const [endsAt, setEndsAt] = useState(localInput(defaultEnd));
  const [customerId, setCustomerId] = useState(appointment?.customerId ?? '');
  const [typeId, setTypeId] = useState(appointment?.appointmentTypeId ?? '');
  const [title, setTitle] = useState(appointment?.title ?? '');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [overlaps, setOverlaps] = useState<AppointmentSummary[]>([]);
  const [confirmOverlap, setConfirmOverlap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void repository
      .listTypes(context.businessId, true)
      .then((rows) => {
        if (live)
          setTypes(rows.filter((row) => row.isActive || row.id === typeId));
      })
      .catch((failure: unknown) => live && setError(errorText(failure)));
    return () => {
      live = false;
    };
  }, [repository, context.businessId, typeId]);

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void searchCustomers(
        customerRepository,
        context.businessId,
        customerQuery,
      )
        .then((rows) => {
          if (live)
            setCustomers(
              rows.filter((row) => row.isActive || row.id === customerId),
            );
        })
        .catch((failure: unknown) => live && setError(errorText(failure)));
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [customerRepository, context.businessId, customerId, customerQuery]);

  function chooseType(id: string) {
    const previous = types.find((row) => row.id === typeId);
    const selected = types.find((row) => row.id === id);
    setTypeId(id);
    if (!selected) return;
    if (!title || title === previous?.name) setTitle(selected.name);
    const startInstant = new Date(startsAt);
    if (!Number.isNaN(startInstant.valueOf()))
      setEndsAt(
        localInput(
          new Date(
            startInstant.getTime() + selected.defaultDurationMinutes * 60_000,
          ),
        ),
      );
  }

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
      setCustomers((current) => [customer, ...current]);
      setCustomerId(customer.id);
      setCustomerQuery(customer.fullName);
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const startIso = new Date(startsAt).toISOString();
      const endIso = new Date(endsAt).toISOString();
      const matches = await repository.overlaps(
        context.businessId,
        context.branchId!,
        startIso,
        endIso,
        appointment?.id,
      );
      if (matches.length && !confirmOverlap) {
        setOverlaps(matches);
        setConfirmOverlap(true);
        return;
      }
      const details = {
        customerId,
        appointmentTypeId: typeId || null,
        title,
        startsAt: startIso,
        endsAt: endIso,
        notes: notes || null,
      };
      if (appointment)
        await updateAppointment(
          repository,
          context.businessId,
          appointment.id,
          details,
        );
      else
        await createAppointment(
          repository,
          {
            businessId: context.businessId,
            branchId: context.branchId!,
            userId: context.userId,
          },
          details,
        );
      onSaved();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  function setStatus(status: AppointmentStatus) {
    if (status === 'cancelled') setConfirmCancel(true);
    else void applyStatus(status);
  }
  async function applyStatus(status: AppointmentStatus) {
    if (!appointment) return;
    setBusy(true);
    setError(null);
    try {
      await changeAppointmentStatus(
        repository,
        context.businessId,
        appointment.id,
        status,
      );
      onSaved();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  const canManage = context.role === 'owner' || context.role === 'admin';

  return (
    <>
      <FormDrawer
        open
        onClose={onClose}
        title={appointment ? 'Editar turno' : 'Nuevo turno'}
        submitLabel={confirmOverlap ? 'Guardar igualmente' : 'Guardar turno'}
        busy={busy}
        error={error}
        onSubmit={save}
      >
        {appointment && (
          <span>
            <StatusBadge
              tone={statusMeta(appointmentStatus, appointment.status).tone}
            >
              {statusLabels[appointment.status]}
            </StatusBadge>
          </span>
        )}
        {confirmOverlap && overlaps.length > 0 && (
          <div className="appointment-overlap" role="alert">
            <strong>Hay una superposición.</strong>
            {overlaps.map((row) => (
              <span key={row.id}>
                Ya existe “{row.title}” entre {time(row.startsAt)} y{' '}
                {time(row.endsAt)}.
              </span>
            ))}
            <small>Podés guardar igualmente si corresponde.</small>
          </div>
        )}
        <div className="editor-grid">
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
          <label className="span-5">
            Tipo de turno
            <select
              value={typeId}
              onChange={(event) => chooseType(event.target.value)}
            >
              <option value="">Sin tipo</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name} · {type.defaultDurationMinutes} min
                </option>
              ))}
            </select>
          </label>
          <label className="span-6">
            Título *
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="span-6 half">
            Inicio *
            <input
              required
              type="datetime-local"
              value={startsAt}
              onChange={(event) => {
                const oldStart = new Date(startsAt);
                const oldEnd = new Date(endsAt);
                const nextStart = new Date(event.target.value);
                const duration = oldEnd.getTime() - oldStart.getTime();
                setStartsAt(event.target.value);
                if (duration > 0 && !Number.isNaN(nextStart.valueOf()))
                  setEndsAt(
                    localInput(new Date(nextStart.getTime() + duration)),
                  );
                setConfirmOverlap(false);
              }}
            />
          </label>
          <label className="span-6 half">
            Fin *
            <input
              required
              type="datetime-local"
              value={endsAt}
              onChange={(event) => {
                setEndsAt(event.target.value);
                setConfirmOverlap(false);
              }}
            />
          </label>
          <label className="span-12">
            Notas
            <textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>
        {appointment && (
          <section className="drawer-section">
            <h3>Estado del turno</h3>
            <div className="editor-state-actions">
              {appointment.status !== 'completed' && (
                <Button disabled={busy} onClick={() => setStatus('completed')}>
                  Marcar como completado
                </Button>
              )}
              {appointment.status !== 'no_show' && (
                <Button disabled={busy} onClick={() => setStatus('no_show')}>
                  Marcar como ausente
                </Button>
              )}
              {appointment.status !== 'scheduled' &&
                (appointment.status !== 'cancelled' || canManage) && (
                  <Button
                    disabled={busy}
                    onClick={() => setStatus('scheduled')}
                  >
                    Volver a programado
                  </Button>
                )}
              {appointment.status !== 'cancelled' && canManage && (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => setStatus('cancelled')}
                >
                  Cancelar turno
                </Button>
              )}
            </div>
          </section>
        )}
      </FormDrawer>
      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar turno"
        destructive
        confirmLabel="Cancelar turno"
        cancelLabel="Volver"
        busy={busy}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          return applyStatus('cancelled');
        }}
      >
        El registro quedará en el historial.
      </ConfirmDialog>
    </>
  );
}

export function CalendarPage({
  repository,
  customerRepository,
  refreshToken,
  onMutation,
}: {
  repository: AppointmentRepository;
  customerRepository: CustomerRepository;
  refreshToken?: number;
  onMutation?: () => void;
}) {
  const context = useBusinessContext();
  const [view, setView] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(startOfDay(new Date()));
  const [status, setStatus] = useState<AppointmentStatus | null>('scheduled');
  const [rows, setRows] = useState<AppointmentSummary[]>([]);
  const [editor, setEditor] = useState<{
    item?: Appointment;
    start?: Date;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const from = view === 'day' ? startOfDay(date) : startOfWeek(date);
  const to = addDays(from, view === 'day' ? 1 : 7);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void repository
      .list({
        businessId: context.businessId,
        branchId: context.branchId!,
        from: from.toISOString(),
        to: to.toISOString(),
        status,
        limit: 500,
      })
      .then((result) => {
        if (live) {
          setRows(result);
          setError(null);
        }
      })
      .catch((failure: unknown) => live && setError(errorText(failure)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [
    repository,
    context.businessId,
    context.branchId,
    from.toISOString(),
    to.toISOString(),
    status,
    refresh,
    refreshToken,
  ]);

  const days = useMemo(
    () =>
      Array.from({ length: view === 'day' ? 1 : 7 }, (_, index) =>
        addDays(from, index),
      ),
    [view, from.toISOString()],
  );
  function saved() {
    setEditor(null);
    setRefresh((value) => value + 1);
    onMutation?.();
  }
  const period =
    view === 'day'
      ? shortDate(from)
      : `${shortDate(from)} – ${shortDate(addDays(to, -1))}`;
  return (
    <>
      <PageHeader
        title="Calendario"
        primaryAction={
          <Button
            variant="primary"
            icon="plus"
            onClick={() => setEditor({ start: date })}
          >
            Nuevo turno
          </Button>
        }
      />
      <AgendaBar
        view={view}
        views={[
          { value: 'day', label: 'Día' },
          { value: 'week', label: 'Semana' },
        ]}
        onView={setView}
        period={period}
        onPrev={() => setDate(addDays(date, view === 'day' ? -1 : -7))}
        onToday={() => setDate(startOfDay(new Date()))}
        onNext={() => setDate(addDays(date, view === 'day' ? 1 : 7))}
        end={
          <select
            aria-label="Filtrar por estado"
            value={status ?? 'all'}
            onChange={(event) =>
              setStatus(
                event.target.value === 'all'
                  ? null
                  : (event.target.value as AppointmentStatus),
              )
            }
          >
            <option value="all">Todos los estados</option>
            {appointmentStatuses.map((value) => (
              <option key={value} value={value}>
                {statusLabels[value]}
              </option>
            ))}
          </select>
        }
      />
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
      {loading ? (
        <p className="meta">Cargando agenda…</p>
      ) : (
        <div className={`calendar-grid ${view}`}>
          {days.map((day) => {
            const entries = rows.filter(
              (row) => dateKey(new Date(row.startsAt)) === dateKey(day),
            );
            return (
              <section className="calendar-day" key={dateKey(day)}>
                <header>
                  {view === 'week' ? (
                    <strong>{shortDate(day)}</strong>
                  ) : (
                    <span className="meta">Turnos del día</span>
                  )}
                  <button
                    type="button"
                    aria-label={`Nuevo turno ${shortDate(day)}`}
                    onClick={() => {
                      const slot = new Date(day);
                      slot.setHours(9, 0, 0, 0);
                      setEditor({ start: slot });
                    }}
                  >
                    +
                  </button>
                </header>
                {entries.length ? (
                  entries.map((item) => (
                    <AppointmentCard
                      key={item.id}
                      item={item}
                      onOpen={(selected) => setEditor({ item: selected })}
                    />
                  ))
                ) : (
                  <button
                    className="empty-day"
                    type="button"
                    onClick={() => {
                      const slot = new Date(day);
                      slot.setHours(9, 0, 0, 0);
                      setEditor({ start: slot });
                    }}
                  >
                    Sin turnos · agregar
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
      {editor && (
        <AppointmentEditor
          repository={repository}
          customerRepository={customerRepository}
          appointment={editor.item}
          initialStart={editor.start}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
    </>
  );
}

export function AppointmentsPage({
  repository,
  customerRepository,
  refreshToken,
  onMutation,
}: {
  repository: AppointmentRepository;
  customerRepository: CustomerRepository;
  refreshToken?: number;
  onMutation?: () => void;
}) {
  const context = useBusinessContext();
  const today = startOfDay(new Date());
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AppointmentStatus | null>(null);
  const [fromDate, setFromDate] = useState(dateKey(addDays(today, -30)));
  const [toDate, setToDate] = useState(dateKey(addDays(today, 90)));
  const [rows, setRows] = useState<AppointmentSummary[]>([]);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // Alta pedida desde el menú «Nuevo»: abre el editor directamente.
    if (takeCreateIntent('appointments')) setSelected({} as Appointment);
  }, []);
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      const to = new Date(`${toDate}T00:00`);
      to.setDate(to.getDate() + 1);
      void repository
        .list({
          businessId: context.businessId,
          branchId: context.branchId!,
          from: new Date(`${fromDate}T00:00`).toISOString(),
          to: to.toISOString(),
          status,
          query,
          limit: 500,
        })
        .then((result) => live && setRows(result))
        .catch((failure: unknown) => live && setError(errorText(failure)));
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [
    repository,
    context.businessId,
    context.branchId,
    query,
    status,
    fromDate,
    toDate,
    refresh,
    refreshToken,
  ]);
  function saved() {
    setSelected(null);
    setRefresh((value) => value + 1);
    onMutation?.();
  }
  return (
    <>
      <PageHeader
        title="Turnos"
        primaryAction={
          <Button
            variant="primary"
            icon="plus"
            onClick={() => setSelected({} as Appointment)}
          >
            Nuevo turno
          </Button>
        }
      />
      <FilterBar
        label="Filtrar turnos"
        search={
          <input
            type="search"
            aria-label="Buscar turnos"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cliente o título"
          />
        }
        end={
          <>
            <label className="filter-inline">
              Desde
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label className="filter-inline">
              Hasta
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
            <select
              aria-label="Filtrar por estado"
              value={status ?? 'all'}
              onChange={(event) =>
                setStatus(
                  event.target.value === 'all'
                    ? null
                    : (event.target.value as AppointmentStatus),
                )
              }
            >
              <option value="all">Todos los estados</option>
              {appointmentStatuses.map((value) => (
                <option key={value} value={value}>
                  {statusLabels[value]}
                </option>
              ))}
            </select>
          </>
        }
      />
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
      <Card className="appointment-list-card">
        {rows.length === 0 ? (
          <EmptyState icon="calendar" title="No hay turnos en este período" />
        ) : (
          rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className="appointment-list-row"
              onClick={() => setSelected(row)}
            >
              <span>{new Date(row.startsAt).toLocaleDateString('es-AR')}</span>
              <strong>{time(row.startsAt)}</strong>
              <span>{row.customerName}</span>
              <span>{row.title}</span>
              <StatusBadge
                tone={statusMeta(appointmentStatus, row.status).tone}
              >
                {statusLabels[row.status]}
              </StatusBadge>
            </button>
          ))
        )}
        {rows.length === 500 && (
          <small>
            Se muestran 500 resultados. Acotá el período o la búsqueda.
          </small>
        )}
      </Card>
      {selected && (
        <AppointmentEditor
          repository={repository}
          customerRepository={customerRepository}
          appointment={selected.id ? selected : null}
          onClose={() => setSelected(null)}
          onSaved={saved}
        />
      )}
    </>
  );
}

export function AppointmentTypesPage({
  repository,
  refreshToken,
  onMutation,
  embedded = false,
}: {
  repository: AppointmentRepository;
  refreshToken?: number;
  onMutation?: () => void;
  embedded?: boolean;
}) {
  const context = useBusinessContext();
  const canManage = context.role === 'owner' || context.role === 'admin';
  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [drawer, setDrawer] = useState<'new' | AppointmentType | null>(null);
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(60);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void repository
      .listTypes(context.businessId, true)
      .then((rows) => live && setTypes(rows))
      .catch((failure: unknown) => live && setError(errorText(failure)));
    return () => {
      live = false;
    };
  }, [repository, context.businessId, refresh, refreshToken]);
  function open(target: 'new' | AppointmentType) {
    setName(target === 'new' ? '' : target.name);
    setDuration(target === 'new' ? 60 : target.defaultDurationMinutes);
    setError(null);
    setDrawer(target);
  }
  async function save() {
    setError(null);
    try {
      if (drawer && drawer !== 'new')
        await updateAppointmentType(repository, context.businessId, drawer.id, {
          name,
          defaultDurationMinutes: duration,
        });
      else
        await createAppointmentType(repository, context.businessId, {
          name,
          defaultDurationMinutes: duration,
        });
      setDrawer(null);
      setRefresh((value) => value + 1);
      onMutation?.();
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  async function toggle(type: AppointmentType) {
    try {
      await repository.setTypeActive(
        context.businessId,
        type.id,
        !type.isActive,
      );
      setDrawer(null);
      setRefresh((value) => value + 1);
      onMutation?.();
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  return (
    <>
      {!embedded && <PageHeader title="Tipos de turno" />}
      {error && !drawer && <InlineMessage tone="error">{error}</InlineMessage>}
      <CatalogSection
        title="Tipos de turno"
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
          <p className="meta price-empty">Todavía no hay tipos de turno.</p>
        ) : (
          types.map((type) => (
            <CatalogRow
              key={type.id}
              title={type.name}
              values={[
                {
                  label: 'Duración predeterminada',
                  value: `${type.defaultDurationMinutes} min`,
                },
              ]}
              active={type.isActive}
              onEdit={canManage ? () => open(type) : undefined}
            />
          ))
        )}
      </CatalogSection>
      <FormDrawer
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        title={
          drawer && drawer !== 'new'
            ? 'Editar tipo de turno'
            : 'Nuevo tipo de turno'
        }
        error={error}
        onSubmit={save}
      >
        <label>
          Nombre
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Duración predeterminada (min)
          <input
            required
            type="number"
            min={1}
            max={1440}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
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
