import { useEffect, useMemo, useState } from 'react';
import {
  createCustomer,
  getCustomer,
  searchCustomers,
  type CustomerRepository,
  type PhotoJobBundle,
  type PhotoJobQuoteRepository,
  type QuotePriceListOption,
} from '@centrocolor/application';
import type { Customer } from '@centrocolor/domain';
import {
  Button,
  Card,
  InlineMessage,
  Select,
  StatusBadge,
} from '@centrocolor/ui';
import { useBusinessContext } from './auth';
import { CustomerField } from './editor-parts';
import { money } from './format';

const kindLabel = {
  public: 'Pública',
  professional: 'Profesional',
  custom: 'Convenio',
} as const;

/**
 * «Presupuestar»: lo que CentroColor hace con una solicitud que llegó sin importe (por ejemplo la
 * de un fotógrafo en /profesionales sin cuenta). Se confirma el cliente y se elige UNA lista de
 * precios; el importe lo calcula y lo guarda el servidor con la autorización de owner/admin. Esta
 * pantalla no puede enviar un precio, y no elige lista por nadie: la del cliente se propone sólo si
 * es profesional o de convenio, nunca la pública.
 */
export function PendingQuotePanel({
  bundle,
  quoteRepository,
  customerRepository,
  onQuoted,
}: {
  bundle: PhotoJobBundle;
  /** Sólo la Web puede presupuestar: Desktop no tiene este repositorio y sólo informa. */
  quoteRepository?: PhotoJobQuoteRepository;
  customerRepository?: CustomerRepository;
  onQuoted: (message: string) => void;
}) {
  const context = useBusinessContext();
  const canQuote = Boolean(quoteRepository) && context.role !== 'staff';
  const [lists, setLists] = useState<QuotePriceListOption[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [changing, setChanging] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState(bundle.job.customerId);
  const [listId, setListId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copies = useMemo(
    () =>
      bundle.items
        .filter((x) => x.isActive)
        .reduce((s, x) => s + x.quantity, 0),
    [bundle.items],
  );

  useEffect(() => {
    if (!canQuote || !quoteRepository) return;
    let live = true;
    quoteRepository
      .listPriceLists(context.businessId)
      .then((value) => live && setLists(value))
      .catch(
        (e) =>
          live &&
          setError(
            e instanceof Error
              ? e.message
              : 'No se pudieron cargar las listas.',
          ),
      );
    return () => {
      live = false;
    };
  }, [quoteRepository, context.businessId, canQuote]);

  // The customer the request is attached to (matched by phone when it arrived) and its own list.
  useEffect(() => {
    if (!customerRepository) return;
    let live = true;
    getCustomer(customerRepository, context.businessId, customerId)
      .then((value) => {
        if (!live) return;
        setCustomer(value);
        setListId('');
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [customerRepository, context.businessId, customerId]);

  useEffect(() => {
    if (!changing || !customerRepository) return;
    let live = true;
    const t = setTimeout(
      () =>
        searchCustomers(customerRepository, context.businessId, query)
          .then((value) => live && setFound(value))
          .catch(() => undefined),
      200,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [changing, query, customerRepository, context.businessId]);

  const suggested = lists.find(
    (x) => x.id === customer?.priceListId && x.kind !== 'public',
  );
  const chosen = lists.find((x) => x.id === (listId || suggested?.id));
  const effectiveListId = chosen?.id ?? '';

  async function confirm() {
    if (!quoteRepository || !effectiveListId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await quoteRepository.quoteJob({
        businessId: context.businessId,
        jobId: bundle.job.id,
        priceListId: effectiveListId,
        customerId: customerId !== bundle.job.customerId ? customerId : null,
      });
      onQuoted(
        `Presupuesto confirmado: ${money(result.totalCents)} con la lista ${result.priceListName}.`,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'No se pudo presupuestar el pedido.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="quote-panel">
      <div className="work-account-heading">
        <h3>Presupuestar</h3>
        <StatusBadge tone="alert">Pendiente de presupuestar</StatusBadge>
      </div>
      <p className="meta">
        Solicitud profesional sin cuenta: {copies}{' '}
        {copies === 1 ? 'copia' : 'copias'} pedidas, todavía sin importe. No se
        puede cobrar, marcar listo ni entregar hasta presupuestarla.
      </p>
      {!canQuote ? (
        <p className="meta">
          {context.role === 'staff'
            ? 'Sólo owner o admin pueden presupuestar. Avisá a quien administra CentroColor.'
            : 'Para presupuestar abrí el panel web de CentroColor: este equipo no fija importes.'}
        </p>
      ) : (
        <>
          <dl className="ficha-data">
            <div>
              <dt>Cliente</dt>
              <dd>{customer?.fullName ?? bundle.customerName}</dd>
            </div>
            <div>
              <dt>Teléfono</dt>
              <dd>{bundle.customerPhone ?? 'Sin teléfono'}</dd>
            </div>
            <div className="ficha-data__wide">
              <dt>Lista del cliente</dt>
              <dd>
                {customer?.priceListId
                  ? (lists.find((x) => x.id === customer.priceListId)?.name ??
                    'Lista inactiva')
                  : 'Sin lista asignada'}
              </dd>
            </div>
          </dl>
          <p className="meta">
            El cliente se identificó por su teléfono: confirmá que es la persona
            correcta antes de elegir la lista.
          </p>
          {customerRepository && (
            <div className="editor-state-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setChanging((value) => !value)}
              >
                {changing ? 'Mantener este cliente' : 'Elegir otro cliente'}
              </Button>
            </div>
          )}
          {changing && customerRepository && (
            <CustomerField
              customers={
                customer && !found.some((x) => x.id === customer.id)
                  ? [customer, ...found]
                  : found
              }
              query={query}
              onQuery={setQuery}
              value={customerId}
              onChange={(id) => id && setCustomerId(id)}
              onQuickCreate={async (fullName) => {
                try {
                  const created = await createCustomer(
                    customerRepository,
                    context.businessId,
                    {
                      fullName,
                      phone: bundle.customerPhone,
                      email: null,
                      documentNumber: null,
                      notes: null,
                    },
                  );
                  setCustomer(created);
                  setCustomerId(created.id);
                  setFound((value) => [created, ...value]);
                  return true;
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : 'No se pudo crear el cliente.',
                  );
                  return false;
                }
              }}
              busy={busy}
            />
          )}
          <label>
            Lista de precios
            <Select
              value={effectiveListId}
              onChange={(next) => setListId(next)}
            >
              <option value="">Elegir lista…</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name} · {kindLabel[list.kind]}
                </option>
              ))}
            </Select>
          </label>
          {!suggested && (
            <p className="meta">
              Este cliente no tiene una lista profesional o de convenio: elegí
              la que corresponda. Nada se aplica por defecto.
            </p>
          )}
          {error && <InlineMessage tone="error">{error}</InlineMessage>}
          <div className="editor-state-actions">
            <Button
              variant="primary"
              disabled={busy || !effectiveListId}
              onClick={() => void confirm()}
            >
              Confirmar presupuesto
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
