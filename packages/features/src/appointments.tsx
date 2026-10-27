import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
import { Card, PageHeader, Segmented } from '@centrocolor/ui';
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
      <small>{statusLabels[item.status]}</small>
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
  const [quickName, setQuickName] = useState('');
  const [showQuick, setShowQuick] = useState(false);
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
      setCustomers((current) => [customer, ...current]);
      setCustomerId(customer.id);
      setCustomerQuery(customer.fullName);
      setShowQuick(false);
      setQuickName('');
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
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

  async function setStatus(status: AppointmentStatus) {
    if (!appointment) return;
    if (
      status === 'cancelled' &&
      !window.confirm(
        '¿Cancelar este turno? El registro quedará en el historial.',
      )
    )
      return;
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

  return (
    <div className="appointment-editor-backdrop" role="presentation">
      <Card className="appointment-editor">
        <div className="appointment-editor-heading">
          <div>
            <small>AGENDA · {context.branchName}</small>
            <h2>{appointment ? 'Editar turno' : 'Nuevo turno'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        {appointment && (
          <span className={`appointment-status status-${appointment.status}`}>
            {statusLabels[appointment.status]}
          </span>
        )}
        {error && (
          <p role="alert" className="appointment-error">
            {error}
          </p>
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
        <form
          className="appointment-form"
          onSubmit={(event) => void save(event)}
        >
          <label className="appointment-form-wide">
            Buscar cliente
            <input
              type="search"
              value={customerQuery}
              placeholder="Nombre, teléfono, email o documento"
              onChange={(event) => setCustomerQuery(event.target.value)}
            />
          </label>
          <label className="appointment-form-wide">
            Cliente *
            <select
              required
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Seleccionar…</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.fullName}
                </option>
              ))}
            </select>
          </label>
          <div className="appointment-form-wide quick-customer">
            <button
              type="button"
              onClick={() => setShowQuick((value) => !value)}
            >
              + Crear cliente
            </button>
            {showQuick && (
              <div>
                <input
                  value={quickName}
                  placeholder="Nombre completo"
                  onChange={(event) => setQuickName(event.target.value)}
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
          <label>
            Título *
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
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
          <label>
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
          <label className="appointment-form-wide">
            Notas
            <textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <div className="appointment-editor-actions appointment-form-wide">
            <button className="customer-primary" type="submit" disabled={busy}>
              {confirmOverlap ? 'Guardar igualmente' : 'Guardar turno'}
            </button>
            <button type="button" onClick={onClose}>
              Volver
            </button>
          </div>
        </form>
        {appointment && (
          <div className="appointment-state-actions">
            {appointment.status !== 'completed' && (
              <button
                disabled={busy}
                type="button"
                onClick={() => void setStatus('completed')}
              >
                Marcar como completado
              </button>
            )}
            {appointment.status !== 'no_show' && (
              <button
                disabled={busy}
                type="button"
                onClick={() => void setStatus('no_show')}
              >
                Marcar como ausente
              </button>
            )}
            {appointment.status !== 'scheduled' &&
              (appointment.status !== 'cancelled' ||
                context.role === 'owner' ||
                context.role === 'admin') && (
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => void setStatus('scheduled')}
                >
                  Volver a programado
                </button>
              )}
            {appointment.status !== 'cancelled' &&
              (context.role === 'owner' || context.role === 'admin') && (
                <button
                  className="danger-action"
                  disabled={busy}
                  type="button"
                  onClick={() => void setStatus('cancelled')}
                >
                  Cancelar turno
                </button>
              )}
          </div>
        )}
      </Card>
    </div>
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
  return (
    <>
      <PageHeader title="Calendario" />
      <div className="agenda-toolbar">
        <Segmented
          label="Vista"
          value={view}
          onChange={setView}
          options={[
            { value: 'day', label: 'Hoy / Día' },
            { value: 'week', label: 'Semana' },
          ]}
        />
        <div className="date-navigation">
          <button
            type="button"
            onClick={() => setDate(addDays(date, view === 'day' ? -1 : -7))}
          >
            ← Anterior
          </button>
          <button type="button" onClick={() => setDate(startOfDay(new Date()))}>
            Hoy
          </button>
          <button
            type="button"
            onClick={() => setDate(addDays(date, view === 'day' ? 1 : 7))}
          >
            Siguiente →
          </button>
        </div>
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
          <option value="all">Todos</option>
          {appointmentStatuses.map((value) => (
            <option key={value} value={value}>
              {statusLabels[value]}
            </option>
          ))}
        </select>
        <button
          className="customer-primary"
          type="button"
          onClick={() => setEditor({ start: date })}
        >
          + Nuevo turno
        </button>
      </div>
      <h2 className="agenda-period-title">
        {view === 'day'
          ? shortDate(from)
          : `${shortDate(from)} – ${shortDate(addDays(to, -1))}`}
      </h2>
      {error && (
        <p className="appointment-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p>Cargando agenda…</p>
      ) : (
        <div className={`calendar-grid ${view}`}>
          {days.map((day) => {
            const entries = rows.filter(
              (row) => dateKey(new Date(row.startsAt)) === dateKey(day),
            );
            return (
              <section className="calendar-day" key={dateKey(day)}>
                <header>
                  <strong>{shortDate(day)}</strong>
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
      <PageHeader title="Turnos" />
      <div className="appointment-list-filters">
        <label>
          Buscar
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cliente o título"
          />
        </label>
        <label>
          Desde
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </label>
        <label>
          Estado
          <select
            value={status ?? 'all'}
            onChange={(event) =>
              setStatus(
                event.target.value === 'all'
                  ? null
                  : (event.target.value as AppointmentStatus),
              )
            }
          >
            <option value="all">Todos</option>
            {appointmentStatuses.map((value) => (
              <option key={value} value={value}>
                {statusLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="customer-primary"
          type="button"
          onClick={() => setSelected({} as Appointment)}
        >
          + Nuevo turno
        </button>
      </div>
      {error && (
        <p role="alert" className="appointment-error">
          {error}
        </p>
      )}
      <Card className="appointment-list-card">
        {rows.length === 0 ? (
          <p>No hay turnos en este período.</p>
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
              <span className={`appointment-status status-${row.status}`}>
                {statusLabels[row.status]}
              </span>
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
  const [editing, setEditing] = useState<AppointmentType | null>(null);
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
  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (editing)
        await updateAppointmentType(
          repository,
          context.businessId,
          editing.id,
          { name, defaultDurationMinutes: duration },
        );
      else
        await createAppointmentType(repository, context.businessId, {
          name,
          defaultDurationMinutes: duration,
        });
      setEditing(null);
      setName('');
      setDuration(60);
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
      setRefresh((value) => value + 1);
      onMutation?.();
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  return (
    <>
      {!embedded && <PageHeader title="Tipos de turno" />}
      {embedded && <h2>Tipos de turno</h2>}
      {error && (
        <p role="alert" className="appointment-error">
          {error}
        </p>
      )}
      {canManage && (
        <Card className="appointment-type-form">
          <form onSubmit={(event) => void save(event)}>
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
            <button className="customer-primary" type="submit">
              {editing ? 'Guardar cambios' : 'Crear tipo'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setName('');
                  setDuration(60);
                }}
              >
                Cancelar
              </button>
            )}
          </form>
        </Card>
      )}
      {!canManage && (
        <p className="customer-storage-note">
          Tu rol puede consultar los tipos. Solo owner/admin puede modificarlos.
        </p>
      )}
      <Card className="appointment-type-list">
        {types.length === 0 ? (
          <p>Todavía no hay tipos de turno configurados.</p>
        ) : (
          types.map((type) => (
            <div key={type.id}>
              <strong>{type.name}</strong>
              <span>{type.defaultDurationMinutes} min</span>
              <span>{type.isActive ? 'Activo' : 'Inactivo'}</span>
              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(type);
                      setName(type.name);
                      setDuration(type.defaultDurationMinutes);
                    }}
                  >
                    Editar
                  </button>
                  <button type="button" onClick={() => void toggle(type)}>
                    {type.isActive ? 'Desactivar' : 'Activar'}
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </Card>
    </>
  );
}
