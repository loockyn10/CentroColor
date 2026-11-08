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
 * de un fotógrafo en /profesionales sin cuenta). Dos decisiones explícitas de owner/admin:
 *
 * 1. El cliente. La solicitud trae su propio cliente «sin verificar» (nombre y teléfono tal como los
 *    escribió quien la envió). Un cliente existente con el mismo teléfono es sólo una SUGERENCIA:
 *    nada se vincula hasta que el administrador lo confirma, y no hay cliente elegido por defecto.
 * 2. La lista de precios. Se propone la del cliente confirmado sólo si es profesional o de convenio,
 *    nunca la pública, y hay que elegirla.
 *
 * El importe lo calcula y lo guarda el servidor; esta pantalla no puede enviar un precio.
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
  // Every customer the panel has seen, by id: the request's own, the suggestions, search results.
  const [known, setKnown] = useState<Record<string, Customer>>({});
  const [matchIds, setMatchIds] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Customer[]>([]);
  // The administrator's explicit choice. Null until somebody confirms one.
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
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
  const remember = (customers: Customer[]) =>
    setKnown((current) => ({
      ...current,
      ...Object.fromEntries(customers.map((x) => [x.id, x])),
    }));

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

  // The request's own (unverified) customer and the existing customers that share its phone.
  useEffect(() => {
    if (!canQuote || !quoteRepository || !customerRepository) return;
    let live = true;
    (async () => {
      const own = await getCustomer(
        customerRepository,
        context.businessId,
        bundle.job.customerId,
      );
      const ids = await quoteRepository.listCustomerMatches(
        context.businessId,
        bundle.job.id,
      );
      const matches = (
        await Promise.all(
          ids.map((id) => getCustomer(customerRepository, context.businessId, id)),
        )
      ).filter((x): x is Customer => Boolean(x));
      if (!live) return;
      remember([...(own ? [own] : []), ...matches]);
      setMatchIds(matches.map((x) => x.id));
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [
    canQuote,
    quoteRepository,
    customerRepository,
    context.businessId,
    bundle.job.id,
    bundle.job.customerId,
  ]);

  useEffect(() => {
    if (!searching || !customerRepository) return;
    let live = true;
    const t = setTimeout(
      () =>
        searchCustomers(customerRepository, context.businessId, query)
          .then((value) => {
            if (!live) return;
            setFound(value);
            remember(value);
          })
          .catch(() => undefined),
      200,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [searching, query, customerRepository, context.businessId]);

  const own = known[bundle.job.customerId];
  const matches = matchIds
    .map((id) => known[id])
    .filter((x): x is Customer => Boolean(x));
  const confirmed = confirmedId ? known[confirmedId] : undefined;
  const listName = (customer: Customer) =>
    customer.priceListId
      ? (lists.find((x) => x.id === customer.priceListId)?.name ??
        'Lista inactiva')
      : 'Sin lista asignada';
  const confirmCustomer = (id: string) => {
    setConfirmedId(id);
    setListId('');
    setSearching(false);
    setError(null);
  };

  // Only the confirmed customer's own professional/convenio list is proposed; nothing else is a default.
  const suggested = lists.find(
    (x) => x.id === confirmed?.priceListId && x.kind !== 'public',
  );
  const chosen = lists.find((x) => x.id === (listId || suggested?.id));
  const effectiveListId = chosen?.id ?? '';

  async function confirm() {
    if (!quoteRepository || !confirmedId || !effectiveListId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await quoteRepository.quoteJob({
        businessId: context.businessId,
        jobId: bundle.job.id,
        priceListId: effectiveListId,
        customerId: confirmedId,
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
        puede cobrar ni pasar a «En proceso», listo o entregado hasta
        presupuestarla.
      </p>
      {!canQuote ? (
        <p className="meta">
          {context.role === 'staff'
            ? 'Sólo owner o admin pueden presupuestar. Avisá a quien administra CentroColor.'
            : 'Para presupuestar abrí el panel web de CentroColor: este equipo no fija importes.'}
        </p>
      ) : (
        <>
          <h4>1. Confirmá el cliente</h4>
          <p className="meta">
            La solicitud no se vincula a ningún cliente existente por sí sola:
            el nombre y el teléfono los escribió quien la envió y no están
            verificados.
          </p>
          <dl className="ficha-data">
            <div>
              <dt>Datos de la solicitud</dt>
              <dd>{own?.fullName ?? bundle.customerName}</dd>
            </div>
            <div>
              <dt>Teléfono</dt>
              <dd>{bundle.customerPhone ?? 'Sin teléfono'}</dd>
            </div>
          </dl>
          {matches.length > 0 && (
            <div className="quote-panel__matches">
              <p className="meta">
                <b>Posible coincidencia por teléfono</b> (sugerencia: verificá
                que sea la misma persona antes de usarla):
              </p>
              {matches.map((customer) => (
                <div className="editor-state-actions" key={customer.id}>
                  <span>
                    <strong>{customer.fullName}</strong> ·{' '}
                    {customer.phone ?? 'Sin teléfono'} · {listName(customer)}
                  </span>
                  <Button
                    variant={confirmedId === customer.id ? 'primary' : 'secondary'}
                    size="sm"
                    disabled={busy}
                    onClick={() => confirmCustomer(customer.id)}
                  >
                    {confirmedId === customer.id
                      ? 'Cliente confirmado'
                      : 'Usar este cliente'}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="editor-state-actions">
            <Button
              variant={
                confirmedId === bundle.job.customerId ? 'primary' : 'secondary'
              }
              size="sm"
              disabled={busy || !own}
              onClick={() => confirmCustomer(bundle.job.customerId)}
            >
              {confirmedId === bundle.job.customerId
                ? 'Cliente nuevo confirmado'
                : 'Mantener como cliente nuevo'}
            </Button>
            {customerRepository && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setSearching((value) => !value)}
              >
                {searching ? 'Cerrar búsqueda' : 'Buscar otro cliente'}
              </Button>
            )}
          </div>
          {searching && customerRepository && (
            <CustomerField
              customers={found}
              query={query}
              onQuery={setQuery}
              value={confirmedId ?? ''}
              onChange={(id) => id && confirmCustomer(id)}
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
                  remember([created]);
                  setFound((value) => [created, ...value]);
                  confirmCustomer(created.id);
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
          {confirmed ? (
            <p className="meta">
              Cliente confirmado: <b>{confirmed.fullName}</b> ·{' '}
              {listName(confirmed)}.
            </p>
          ) : (
            <p className="meta">Todavía no confirmaste ningún cliente.</p>
          )}
          <h4>2. Elegí la lista de precios</h4>
          <label>
            Lista de precios
            <Select
              value={effectiveListId}
              disabled={!confirmed}
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
          {confirmed && !suggested && (
            <p className="meta">
              Este cliente no tiene una lista profesional o de convenio: elegí
              la que corresponda. Nada se aplica por defecto.
            </p>
          )}
          {error && <InlineMessage tone="error">{error}</InlineMessage>}
          <div className="editor-state-actions">
            <Button
              variant="primary"
              disabled={busy || !confirmedId || !effectiveListId}
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
