import { useEffect, useState } from 'react';
import {
  createCustomer,
  deactivateCustomer,
  getCustomer,
  reactivateCustomer,
  searchCustomers,
  updateCustomer,
  type CustomerRepository,
  type EventRepository,
  type EventSummary,
  type PhotoJobSummary,
  type PhotoRepository,
  type ServiceCatalogRepository,
  type WorkPaymentRepository,
} from '@centrocolor/application';
import {
  eventStatuses,
  type Customer,
  type CustomerDetails,
  type PriceList,
} from '@centrocolor/domain';
import {
  Button,
  Card,
  EmptyState,
  FormDrawer,
  Icon,
  InlineMessage,
  PageHeader,
  StatusBadge,
  takeCreateIntent,
} from '@centrocolor/ui';
import { eventStatus, photoJobStatus, statusMeta } from './status';
import { useBusinessContext } from './auth';
import { CustomerAccountPanel } from './payments';
import { dueText } from './format';

const emptyDetails: CustomerDetails = {
  fullName: '',
  phone: null,
  email: null,
  documentNumber: null,
  notes: null,
};

const detailsOf = (customer: Customer): CustomerDetails => ({
  fullName: customer.fullName,
  phone: customer.phone,
  email: customer.email,
  documentNumber: customer.documentNumber,
  notes: customer.notes,
});

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Ocurrió un error. Reintentá.';
}

/** Número para `wa.me`: sólo dígitos, sin 0 inicial, con 549 si no trae código de país. */
export function whatsappNumber(phone: string) {
  const digits = phone.replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return null;
  return digits.startsWith('54') ? digits : `549${digits}`;
}

export function CustomersPage({
  repository,
  storage,
  refreshToken,
  onLocalMutation,
  paymentRepository,
  photoRepository,
  serviceCatalogRepository,
  eventRepository,
  initialCustomerId,
  onNewJob,
  onOpenJob,
}: {
  repository: CustomerRepository;
  storage: 'cloud' | 'local';
  refreshToken?: number;
  onLocalMutation?: () => void;
  paymentRepository: WorkPaymentRepository;
  /** Opcional: habilita «Pedidos» en la ficha. */
  photoRepository?: PhotoRepository;
  serviceCatalogRepository?: ServiceCatalogRepository;
  /** Opcional: habilita «Presupuestos y reservas» en la ficha (sólo lectura). */
  eventRepository?: EventRepository;
  /** Abre la ficha de un cliente (p. ej. desde el buscador global). */
  initialCustomerId?: string | null;
  /** «Nuevo pedido» con el cliente preseleccionado. */
  onNewJob?: (customerId: string) => void;
  onOpenJob?: (jobId: string) => void;
}) {
  const { businessId, branchId, role } = useBusinessContext();
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [mode, setMode] = useState<'idle' | 'detail'>('idle');
  const [form, setForm] = useState<'new' | 'edit' | null>(null);
  const [draftList, setDraftList] = useState('');
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [details, setDetails] = useState<CustomerDetails>(emptyDetails);
  const [jobs, setJobs] = useState<PhotoJobSummary[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    // Alta pedida desde el menú «Nuevo»: abre el formulario directamente.
    if (takeCreateIntent('customers')) openNew();
  }, []);
  function openNew() {
    setDetails(emptyDetails);
    setError(null);
    setForm('new');
  }
  function openEdit() {
    if (!selected) return;
    setDetails(detailsOf(selected));
    setDraftList(selected.priceListId ?? '');
    setError(null);
    setForm('edit');
  }

  useEffect(() => {
    if (!serviceCatalogRepository) return;
    void serviceCatalogRepository
      .listPriceLists(businessId)
      .then(setPriceLists)
      .catch((e) => setError(errorMessage(e)));
  }, [businessId, serviceCatalogRepository, refreshToken]);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        void searchCustomers(repository, businessId, query)
          .then((rows) => {
            if (live) {
              setCustomers(rows);
              setError(null);
            }
          })
          .catch((searchError: unknown) => {
            if (live) setError(errorMessage(searchError));
          })
          .finally(() => {
            if (live) setLoading(false);
          });
      },
      query ? 200 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [repository, businessId, query, refresh, refreshToken]);

  function openCustomer(customer: Customer) {
    setSelected(customer);
    setDetails(detailsOf(customer));
    setError(null);
    setMode('detail');
  }

  useEffect(() => {
    if (!initialCustomerId) return;
    let live = true;
    void getCustomer(repository, businessId, initialCustomerId)
      .then((customer) => {
        if (live && customer) openCustomer(customer);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [repository, businessId, initialCustomerId]);

  useEffect(() => {
    if (!photoRepository || !selected || !branchId) {
      setJobs([]);
      return;
    }
    let live = true;
    void photoRepository
      .listJobs(businessId, branchId, { search: selected.fullName, limit: 50 })
      .then((rows) => {
        if (live)
          setJobs(rows.filter((row) => row.job.customerId === selected.id));
      })
      .catch(() => live && setJobs([]));
    return () => {
      live = false;
    };
  }, [photoRepository, businessId, branchId, selected, refresh, refreshToken]);

  useEffect(() => {
    if (!eventRepository || !selected || !branchId) {
      setEvents([]);
      return;
    }
    let live = true;
    void eventRepository
      .listEvents({
        businessId,
        branchId,
        statuses: [...eventStatuses],
        query: selected.fullName,
        limit: 50,
      })
      .then((rows) => {
        if (live)
          setEvents(rows.filter((row) => row.customerId === selected.id));
      })
      .catch(() => live && setEvents([]));
    return () => {
      live = false;
    };
  }, [eventRepository, businessId, branchId, selected, refresh, refreshToken]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let saved =
        form === 'new'
          ? await createCustomer(repository, businessId, details)
          : await updateCustomer(repository, businessId, selected!.id, details);
      if (
        form === 'edit' &&
        repository.assignPriceList &&
        role !== 'staff' &&
        serviceCatalogRepository &&
        (saved.priceListId ?? '') !== draftList
      )
        saved = await repository.assignPriceList(
          businessId,
          saved.id,
          draftList || null,
        );
      setSelected(saved);
      setDetails(detailsOf(saved));
      setMode('detail');
      setForm(null);
      setRefresh((value) => value + 1);
      onLocalMutation?.();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const updated = selected.isActive
        ? await deactivateCustomer(repository, businessId, selected.id)
        : await reactivateCustomer(repository, businessId, selected.id);
      const fresh = await getCustomer(repository, businessId, updated.id);
      setSelected(fresh ?? updated);
      setForm(null);
      setRefresh((value) => value + 1);
      onLocalMutation?.();
    } catch (toggleError) {
      setError(errorMessage(toggleError));
    } finally {
      setBusy(false);
    }
  }

  const whatsapp = selected?.phone ? whatsappNumber(selected.phone) : null;
  const priceListName = (id: string | null | undefined) =>
    id
      ? (priceLists.find((list) => list.id === id)?.name ?? 'Lista asignada')
      : 'Público (predeterminada)';

  return (
    <>
      <PageHeader
        title="Clientes"
        primaryAction={
          <Button variant="primary" icon="plus" onClick={openNew}>
            Nuevo cliente
          </Button>
        }
      />
      {storage === 'local' && (
        <p className="meta customer-storage-note">
          Se guardan en este equipo y se sincronizan al validar el acceso.
        </p>
      )}
      {error && !form && <InlineMessage tone="error">{error}</InlineMessage>}
      <div
        className={`customers ${mode === 'idle' ? '' : 'has-detail'}`.trim()}
      >
        <section className="customers-list" aria-label="Listado de clientes">
          <div className="search-field">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Buscar clientes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nombre, teléfono, email o documento"
            />
          </div>
          <Card className="card--flush">
            {loading ? (
              <p className="pad muted">Cargando clientes…</p>
            ) : customers.length === 0 ? (
              <EmptyState
                icon="users"
                title={query ? 'Sin resultados' : 'Todavía no hay clientes'}
              />
            ) : (
              <div className="rows">
                {customers.map((customer) => (
                  <button
                    className={`oprow customer-row ${selected?.id === customer.id && mode === 'detail' ? 'is-selected' : ''}`.trim()}
                    style={{ ['--cols' as string]: 'minmax(0, 1fr) auto' }}
                    type="button"
                    key={customer.id}
                    aria-current={
                      selected?.id === customer.id && mode === 'detail'
                    }
                    onClick={() => openCustomer(customer)}
                  >
                    <span>
                      <span className="who">{customer.fullName}</span>
                      <span className="meta block">
                        {customer.phone || customer.email || '—'}
                      </span>
                    </span>
                    {!customer.isActive && (
                      <StatusBadge tone="closed">Inactivo</StatusBadge>
                    )}
                  </button>
                ))}
              </div>
            )}
            {customers.length === 100 && (
              <p className="pad meta">
                Se muestran los primeros 100. Usá la búsqueda para encontrar
                otros clientes.
              </p>
            )}
          </Card>
        </section>

        {mode === 'detail' && selected && (
          <section className="customers-detail" aria-label="Ficha de cliente">
            <button
              className="customer-back"
              type="button"
              onClick={() => setMode('idle')}
            >
              ← Clientes
            </button>
            <Card>
              <header className="ficha-head">
                <div>
                  <h2>{selected.fullName}</h2>
                  {!selected.isActive && (
                    <StatusBadge tone="closed">Inactivo</StatusBadge>
                  )}
                </div>
                <div className="ficha-actions">
                  {onNewJob && selected.isActive && (
                    <Button
                      variant="primary"
                      icon="camera"
                      onClick={() => onNewJob(selected.id)}
                    >
                      Nuevo pedido
                    </Button>
                  )}
                  {whatsapp && (
                    <a
                      className="btn"
                      href={`https://wa.me/${whatsapp}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Icon name="chat" /> WhatsApp
                    </a>
                  )}
                  <Button variant="ghost" icon="edit" onClick={openEdit}>
                    Editar
                  </Button>
                </div>
              </header>

              <section className="ficha-section" aria-label="Datos">
                <h3>Datos</h3>
                <dl className="ficha-data">
                  <div>
                    <dt>Teléfono</dt>
                    <dd>
                      {selected.phone ? (
                        <a href={`tel:${selected.phone}`}>
                          <Icon name="phone" size={16} /> {selected.phone}
                        </a>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>
                      {selected.email ? (
                        <a href={`mailto:${selected.email}`}>
                          <Icon name="mail" size={16} /> {selected.email}
                        </a>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Documento</dt>
                    <dd>{selected.documentNumber || '—'}</dd>
                  </div>
                  {serviceCatalogRepository && (
                    <div>
                      <dt>Lista de precios</dt>
                      <dd>{priceListName(selected.priceListId)}</dd>
                    </div>
                  )}
                  {selected.notes && (
                    <div className="ficha-data__wide">
                      <dt>Notas</dt>
                      <dd>{selected.notes}</dd>
                    </div>
                  )}
                </dl>
              </section>

              <div className="ficha-section">
                <CustomerAccountPanel
                  repository={paymentRepository}
                  customerId={selected.id}
                  refreshToken={refreshToken}
                />
              </div>

              {photoRepository && (
                <section className="ficha-section" aria-label="Pedidos">
                  <h3>Pedidos de laboratorio</h3>
                  {jobs.length === 0 ? (
                    <p className="meta">Sin pedidos de laboratorio.</p>
                  ) : (
                    <div className="rows">
                      {jobs.slice(0, 8).map((row) => (
                        <button
                          type="button"
                          className="oprow"
                          style={{
                            ['--cols' as string]: 'minmax(0, 1fr) auto auto',
                          }}
                          key={row.job.id}
                          disabled={!onOpenJob}
                          onClick={() => onOpenJob?.(row.job.id)}
                        >
                          <span className="what">
                            {row.itemSummary || 'Pedido'}
                          </span>
                          <span className="meta">
                            {dueText(row.job.promisedAt)}
                          </span>
                          <StatusBadge
                            tone={
                              statusMeta(photoJobStatus, row.job.status).tone
                            }
                          >
                            {statusMeta(photoJobStatus, row.job.status).label}
                          </StatusBadge>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {eventRepository && (
                <section className="ficha-section" aria-label="Reservas">
                  <h3>Presupuestos y reservas</h3>
                  {events.length === 0 ? (
                    <p className="meta">Sin presupuestos ni reservas.</p>
                  ) : (
                    <div className="rows">
                      {events.slice(0, 8).map((row) => (
                        <div
                          className="oprow"
                          style={{
                            ['--cols' as string]: 'minmax(0, 1fr) auto auto',
                          }}
                          key={row.id}
                        >
                          <span className="what">{row.title}</span>
                          <span className="meta">
                            {new Date(row.startsAt).toLocaleDateString(
                              'es-AR',
                              { day: '2-digit', month: '2-digit' },
                            )}
                          </span>
                          <StatusBadge
                            tone={statusMeta(eventStatus, row.status).tone}
                          >
                            {statusMeta(eventStatus, row.status).label}
                          </StatusBadge>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </Card>
          </section>
        )}
      </div>

      <FormDrawer
        open={form !== null}
        onClose={() => setForm(null)}
        title={form === 'new' ? 'Nuevo cliente' : 'Editar cliente'}
        submitLabel={form === 'new' ? 'Guardar cliente' : 'Guardar cambios'}
        busy={busy}
        error={error}
        onSubmit={save}
      >
        <label>
          Nombre completo *
          <input
            required
            value={details.fullName}
            onChange={(event) =>
              setDetails({ ...details, fullName: event.target.value })
            }
          />
        </label>
        <div className="config-editor-form__grid">
          <label>
            Teléfono
            <input
              type="tel"
              value={details.phone ?? ''}
              onChange={(event) =>
                setDetails({ ...details, phone: event.target.value })
              }
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={details.email ?? ''}
              onChange={(event) =>
                setDetails({ ...details, email: event.target.value })
              }
            />
          </label>
        </div>
        <label>
          Documento
          <input
            value={details.documentNumber ?? ''}
            onChange={(event) =>
              setDetails({ ...details, documentNumber: event.target.value })
            }
          />
        </label>
        {form === 'edit' && serviceCatalogRepository && (
          <label>
            Lista de precios
            <select
              value={draftList}
              disabled={role === 'staff' || !repository.assignPriceList}
              onChange={(event) => setDraftList(event.target.value)}
            >
              <option value="">Público (predeterminada)</option>
              {priceLists
                .filter((list) => list.isActive && !list.isDefault)
                .map((list) => (
                  <option value={list.id} key={list.id}>
                    {list.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          Notas
          <textarea
            rows={3}
            value={details.notes ?? ''}
            onChange={(event) =>
              setDetails({ ...details, notes: event.target.value })
            }
          />
        </label>
        {form === 'edit' && selected && (
          <section className="drawer-section">
            <h3>Estado del cliente</h3>
            <Button
              variant={selected.isActive ? 'danger' : 'secondary'}
              disabled={busy}
              onClick={() => void toggleActive()}
            >
              {selected.isActive ? 'Desactivar cliente' : 'Reactivar cliente'}
            </Button>
          </section>
        )}
      </FormDrawer>
    </>
  );
}
