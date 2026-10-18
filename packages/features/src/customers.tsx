import { useEffect, useState, type FormEvent } from 'react';
import {
  createCustomer,
  deactivateCustomer,
  getCustomer,
  reactivateCustomer,
  searchCustomers,
  updateCustomer,
  type CustomerRepository,
  type PhotoJobSummary,
  type PhotoRepository,
  type WorkPaymentRepository,
} from '@centrocolor/application';
import type { Customer, CustomerDetails } from '@centrocolor/domain';
import { Button, Card, EmptyState, Icon, PageHeader } from '@centrocolor/ui';
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

const jobStatus: Record<string, string> = {
  received: 'Recibido',
  in_progress: 'En proceso',
  ready: 'Listo para entregar',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

export function CustomersPage({
  repository,
  storage,
  refreshToken,
  onLocalMutation,
  paymentRepository,
  photoRepository,
  initialCustomerId,
  onNewJob,
  onOpenJob,
}: {
  repository: CustomerRepository;
  storage: 'cloud' | 'local';
  refreshToken?: number;
  onLocalMutation?: () => void;
  paymentRepository: WorkPaymentRepository;
  /** Opcional: habilita «Trabajos» en la ficha. */
  photoRepository?: PhotoRepository;
  /** Abre la ficha de un cliente (p. ej. desde el buscador global). */
  initialCustomerId?: string | null;
  /** «Nuevo trabajo» con el cliente preseleccionado. */
  onNewJob?: (customerId: string) => void;
  onOpenJob?: (jobId: string) => void;
}) {
  const { businessId, branchId } = useBusinessContext();
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [mode, setMode] = useState<'idle' | 'new' | 'detail'>('idle');
  const [details, setDetails] = useState<CustomerDetails>(emptyDetails);
  const [jobs, setJobs] = useState<PhotoJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved =
        mode === 'new'
          ? await createCustomer(repository, businessId, details)
          : await updateCustomer(repository, businessId, selected!.id, details);
      setSelected(saved);
      setDetails(detailsOf(saved));
      setMode('detail');
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
      setRefresh((value) => value + 1);
      onLocalMutation?.();
    } catch (toggleError) {
      setError(errorMessage(toggleError));
    } finally {
      setBusy(false);
    }
  }

  const whatsapp = selected?.phone ? whatsappNumber(selected.phone) : null;

  return (
    <>
      <PageHeader
        title="Clientes"
        actions={
          <Button
            variant="primary"
            icon="plus"
            onClick={() => {
              setDetails(emptyDetails);
              setSelected(null);
              setError(null);
              setMode('new');
            }}
          >
            Nuevo cliente
          </Button>
        }
      />
      {storage === 'local' && (
        <p className="meta customer-storage-note">
          Se guardan en este equipo y se sincronizan al validar el acceso.
        </p>
      )}
      {error && (
        <p className="customer-error" role="alert">
          {error}
        </p>
      )}
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
                      <span className="state-line">
                        <span className="tone-warn">Inactivo</span>
                      </span>
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

        {mode !== 'idle' && (
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
                  <h2>
                    {mode === 'new' ? 'Nuevo cliente' : selected?.fullName}
                  </h2>
                  {selected && (
                    <p className="meta">
                      {[selected.phone, selected.email]
                        .filter(Boolean)
                        .join(' · ') || 'Sin datos de contacto'}
                      {!selected.isActive && ' · Inactivo'}
                    </p>
                  )}
                </div>
                {selected && (
                  <div className="ficha-actions">
                    {whatsapp && (
                      <a
                        className="btn btn--primary"
                        href={`https://wa.me/${whatsapp}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Icon name="chat" /> WhatsApp
                      </a>
                    )}
                    {onNewJob && selected.isActive && (
                      <Button
                        variant="primary"
                        icon="camera"
                        onClick={() => onNewJob(selected.id)}
                      >
                        Nuevo trabajo
                      </Button>
                    )}
                    {selected.phone && (
                      <a
                        className="btn btn--ghost btn--sm"
                        href={`tel:${selected.phone}`}
                        aria-label={`Llamar a ${selected.fullName}`}
                      >
                        <Icon name="phone" /> Llamar
                      </a>
                    )}
                    {selected.email && (
                      <a
                        className="btn btn--ghost btn--sm"
                        href={`mailto:${selected.email}`}
                        aria-label={`Escribir a ${selected.fullName}`}
                      >
                        <Icon name="mail" /> Email
                      </a>
                    )}
                  </div>
                )}
              </header>

              {selected && (
                <div className="ficha-section">
                  <CustomerAccountPanel
                    repository={paymentRepository}
                    customerId={selected.id}
                    refreshToken={refreshToken}
                  />
                </div>
              )}

              {selected && photoRepository && (
                <div className="ficha-section">
                  <h3>Trabajos</h3>
                  {jobs.length === 0 ? (
                    <p className="meta">Sin trabajos fotográficos.</p>
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
                            {row.itemSummary || 'Trabajo'}
                          </span>
                          <span className="meta">
                            {dueText(row.job.promisedAt)}
                          </span>
                          <span className="state-line">
                            <span>{jobStatus[row.job.status]}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <form
                className="customer-form ficha-section"
                onSubmit={(event) => void save(event)}
              >
                <h3 className="customer-form-wide">Datos</h3>
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
                <label>
                  Documento
                  <input
                    value={details.documentNumber ?? ''}
                    onChange={(event) =>
                      setDetails({
                        ...details,
                        documentNumber: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="customer-form-wide">
                  Notas
                  <textarea
                    rows={3}
                    value={details.notes ?? ''}
                    onChange={(event) =>
                      setDetails({ ...details, notes: event.target.value })
                    }
                  />
                </label>
                <div className="customer-actions">
                  <button
                    className="customer-primary"
                    type="submit"
                    disabled={busy}
                  >
                    {mode === 'new' ? 'Guardar cliente' : 'Guardar cambios'}
                  </button>
                  {selected && (
                    <button
                      className="customer-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void toggleActive()}
                    >
                      {selected.isActive
                        ? 'Desactivar cliente'
                        : 'Reactivar cliente'}
                    </button>
                  )}
                </div>
              </form>
            </Card>
          </section>
        )}
      </div>
    </>
  );
}
