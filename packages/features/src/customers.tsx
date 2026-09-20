import { useEffect, useState, type FormEvent } from 'react';
import {
  createCustomer,
  deactivateCustomer,
  getCustomer,
  reactivateCustomer,
  searchCustomers,
  updateCustomer,
  type CustomerRepository,
} from '@centrocolor/application';
import type { Customer, CustomerDetails } from '@centrocolor/domain';
import { Card, PageHeader } from '@centrocolor/ui';
import { useBusinessContext } from './auth';

const emptyDetails: CustomerDetails = {
  fullName: '',
  phone: null,
  email: null,
  documentNumber: null,
  notes: null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Ocurrió un error. Reintentá.';
}

export function CustomersPage({
  repository,
  storage,
}: {
  repository: CustomerRepository;
  storage: 'cloud' | 'local';
}) {
  const { businessId } = useBusinessContext();
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [mode, setMode] = useState<'list' | 'new' | 'detail'>('list');
  const [details, setDetails] = useState<CustomerDetails>(emptyDetails);
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
  }, [repository, businessId, query, refresh]);

  function openCustomer(customer: Customer) {
    setSelected(customer);
    setDetails({
      fullName: customer.fullName,
      phone: customer.phone,
      email: customer.email,
      documentNumber: customer.documentNumber,
      notes: customer.notes,
    });
    setError(null);
    setMode('detail');
  }

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
      setDetails({
        fullName: saved.fullName,
        phone: saved.phone,
        email: saved.email,
        documentNumber: saved.documentNumber,
        notes: saved.notes,
      });
      setMode('detail');
      setRefresh((value) => value + 1);
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
    } catch (toggleError) {
      setError(errorMessage(toggleError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="CLIENTES"
        title={
          mode === 'new'
            ? 'Nuevo cliente'
            : mode === 'detail'
              ? 'Ficha de cliente'
              : 'Clientes'
        }
        description="Datos de contacto del negocio actual."
      />
      <p className="customer-storage-note">
        {storage === 'cloud'
          ? 'Los clientes de Web se guardan en Supabase.'
          : 'Los clientes de Desktop se guardan en este equipo. Todavía no se sincronizan con Web.'}
      </p>
      {error && (
        <p className="customer-error" role="alert">
          {error}
        </p>
      )}
      {mode === 'list' ? (
        <>
          <div className="customer-toolbar">
            <label>
              Buscar clientes
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nombre, teléfono, email o documento"
              />
            </label>
            <button
              className="customer-primary"
              type="button"
              onClick={() => {
                setDetails(emptyDetails);
                setSelected(null);
                setError(null);
                setMode('new');
              }}
            >
              Nuevo cliente
            </button>
          </div>
          <Card className="customer-list-card">
            {loading ? (
              <p>Cargando clientes…</p>
            ) : customers.length === 0 ? (
              <p>
                {query
                  ? 'No hay resultados para esta búsqueda.'
                  : 'Todavía no hay clientes.'}
              </p>
            ) : (
              <>
                <div className="customer-list-heading">
                  <span>Nombre</span>
                  <span>Teléfono</span>
                  <span>Email</span>
                  <span>Estado</span>
                </div>
                {customers.map((customer) => (
                  <button
                    className="customer-row"
                    type="button"
                    key={customer.id}
                    onClick={() => openCustomer(customer)}
                  >
                    <strong>{customer.fullName}</strong>
                    <span>{customer.phone || '—'}</span>
                    <span>{customer.email || '—'}</span>
                    <span
                      className={
                        customer.isActive
                          ? 'customer-active'
                          : 'customer-inactive'
                      }
                    >
                      {customer.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </button>
                ))}
                {customers.length === 100 && (
                  <p className="customer-limit">
                    Se muestran los primeros 100. Usá la búsqueda para encontrar
                    otros clientes.
                  </p>
                )}
              </>
            )}
          </Card>
        </>
      ) : (
        <Card className="customer-detail-card">
          <button
            className="customer-back"
            type="button"
            onClick={() => setMode('list')}
          >
            ← Volver a clientes
          </button>
          {selected && (
            <p className="customer-detail-status">
              Estado: {selected.isActive ? 'Activo' : 'Inactivo'}
            </p>
          )}
          <form
            className="customer-form"
            onSubmit={(event) => void save(event)}
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
                  setDetails({ ...details, documentNumber: event.target.value })
                }
              />
            </label>
            <label className="customer-form-wide">
              Notas
              <textarea
                rows={4}
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
          {selected && (
            <p className="customer-future">
              El historial de este cliente estará disponible en un sprint
              futuro.
            </p>
          )}
        </Card>
      )}
    </>
  );
}
