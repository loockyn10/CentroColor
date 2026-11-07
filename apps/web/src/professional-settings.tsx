import { useEffect, useMemo, useState } from 'react';
import type {
  BusinessContext,
  CustomerRepository,
  ServiceCatalogRepository,
} from '@centrocolor/application';
import type { Customer, PriceList } from '@centrocolor/domain';
import {
  Button,
  FormDrawer,
  InlineMessage,
  IntegrationCard,
  StatusBadge,
} from '@centrocolor/ui';
import type {
  ProfessionalAccountView,
  SupabaseProfessionalAdminRepository,
} from './professional-admin';

const errorText = (x: unknown) =>
  x instanceof Error ? x.message : 'No se pudo completar la operación.';

/**
 * Configuración → Integraciones → Portal profesional (owner/admin).
 *
 * Giving access links an e-mail to an EXISTING customer: the customer's price list (Profesional
 * or a convenio, assigned in Clientes → Editar) is what the portal charges, and "pago posterior"
 * is decided here per client, never by signing in.
 */
export function ProfessionalSettingsPage({
  context,
  repository,
  customerRepository,
  serviceCatalogRepository,
}: {
  context: BusinessContext;
  repository: SupabaseProfessionalAdminRepository;
  customerRepository: CustomerRepository;
  serviceCatalogRepository: ServiceCatalogRepository;
}) {
  const admin = context.role !== 'staff';
  const [accounts, setAccounts] = useState<ProfessionalAccountView[] | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (!admin) return;
    repository
      .list(context.businessId)
      .then(setAccounts)
      .catch((x) => setMessage(errorText(x)));
  }, [admin, context.businessId, repository]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (x) {
      setMessage(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  const patch = (
    account: ProfessionalAccountView,
    change: { isActive?: boolean; allowDeferredPayment?: boolean },
  ) =>
    run(async () =>
      setAccounts(
        await repository.update(context.businessId, account.id, change),
      ),
    );

  if (!admin)
    return (
      <IntegrationCard title="Portal profesional">
        <p className="meta">
          Sólo owner o admin pueden dar acceso al portal profesional.
        </p>
      </IntegrationCard>
    );
  return (
    <>
      <IntegrationCard
        title="Portal profesional"
        status={
          <StatusBadge tone="closed">
            {accounts ? `${accounts.length} cuentas` : '…'}
          </StatusBadge>
        }
        actions={
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => setLinking(true)}
          >
            Dar acceso a un profesional
          </Button>
        }
      >
        <p className="meta">
          Los profesionales ingresan en <strong>/profesionales</strong> y pagan
          según la lista de precios de su cliente. No acceden a este panel.
        </p>
        {message && !linking && (
          <InlineMessage tone="error">{message}</InlineMessage>
        )}
        {accounts?.length === 0 && (
          <p className="meta">Todavía no hay cuentas profesionales.</p>
        )}
        <ul className="catalog-list">
          {accounts?.map((account) => (
            <li key={account.id} className="catalog-row">
              <div>
                <strong>{account.customerName}</strong>{' '}
                <StatusBadge tone={account.isActive ? 'ok' : 'closed'}>
                  {account.isActive ? 'Activa' : 'Desactivada'}
                </StatusBadge>
                <div className="meta">
                  {account.email} · Lista:{' '}
                  {account.priceListUsable
                    ? account.priceListName
                    : 'sin lista profesional (no puede pedir)'}{' '}
                  ·{' '}
                  {account.allowDeferredPayment
                    ? 'Puede pagar después'
                    : 'Paga antes de imprimir'}
                </div>
              </div>
              <div className="catalog-row__actions">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void patch(account, {
                      allowDeferredPayment: !account.allowDeferredPayment,
                    })
                  }
                >
                  {account.allowDeferredPayment
                    ? 'Quitar pago posterior'
                    : 'Permitir pago posterior'}
                </Button>
                <Button
                  size="sm"
                  variant={account.isActive ? 'danger' : 'secondary'}
                  disabled={busy}
                  onClick={() =>
                    void patch(account, { isActive: !account.isActive })
                  }
                >
                  {account.isActive ? 'Desactivar' : 'Reactivar'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </IntegrationCard>
      <LinkDrawer
        open={linking}
        context={context}
        busy={busy}
        error={linking ? message : null}
        customerRepository={customerRepository}
        serviceCatalogRepository={serviceCatalogRepository}
        onClose={() => setLinking(false)}
        onLink={(input) =>
          run(async () => {
            const result = await repository.link(context.businessId, input);
            setAccounts(result.accounts);
            setLinking(false);
            setMessage(
              result.invited
                ? `Le enviamos un e-mail a ${input.email} para que elija su contraseña.`
                : `${input.email} ya tenía usuario: puede ingresar con su contraseña.`,
            );
          })
        }
      />
    </>
  );
}

function LinkDrawer({
  open,
  context,
  busy,
  error,
  customerRepository,
  serviceCatalogRepository,
  onClose,
  onLink,
}: {
  open: boolean;
  context: BusinessContext;
  busy: boolean;
  error: string | null;
  customerRepository: CustomerRepository;
  serviceCatalogRepository: ServiceCatalogRepository;
  onClose: () => void;
  onLink: (input: {
    email: string;
    customerId: string;
    allowDeferredPayment: boolean;
  }) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Customer[]>([]);
  const [lists, setLists] = useState<PriceList[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [deferred, setDeferred] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCustomerId(null);
    setEmail('');
    setDeferred(false);
    void serviceCatalogRepository
      .listPriceLists(context.businessId)
      .then(setLists)
      .catch(() => setLists([]));
  }, [open, context.businessId, serviceCatalogRepository]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const search = query.trim()
        ? customerRepository.search(context.businessId, query.trim(), 12)
        : customerRepository.list(context.businessId, 12);
      void search.then(setFound).catch(() => setFound([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, query, context.businessId, customerRepository]);

  const listOf = useMemo(() => {
    const byId = new Map(lists.map((list) => [list.id, list]));
    return (customer: Customer) =>
      customer.priceListId ? (byId.get(customer.priceListId) ?? null) : null;
  }, [lists]);
  const eligible = (customer: Customer) => {
    const list = listOf(customer);
    return (
      customer.isActive && !!list && list.isActive && list.kind !== 'public'
    );
  };

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title="Dar acceso a un profesional"
      busy={busy}
      error={error}
      submitLabel="Dar acceso"
      disabled={!customerId || !email.trim()}
      onSubmit={() => {
        if (!customerId) return Promise.resolve();
        return onLink({
          email: email.trim(),
          customerId,
          allowDeferredPayment: deferred,
        });
      }}
    >
      <label>
        Cliente
        <input
          type="search"
          placeholder="Buscar por nombre, teléfono o email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <ul className="catalog-list" aria-label="Clientes">
        {found.map((customer) => {
          const list = listOf(customer);
          const ok = eligible(customer);
          return (
            <li key={customer.id} className="catalog-row">
              <label>
                <input
                  type="radio"
                  name="professional-customer"
                  disabled={!ok}
                  checked={customerId === customer.id}
                  onChange={() => {
                    setCustomerId(customer.id);
                    if (!email && customer.email) setEmail(customer.email);
                  }}
                />{' '}
                <strong>{customer.fullName}</strong>
                <span className="meta">
                  {' '}
                  ·{' '}
                  {ok
                    ? `Lista: ${list!.name}`
                    : 'sin lista Profesional o de convenio (asignala en Clientes → Editar)'}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <label>
        E-mail de acceso *
        <input
          type="email"
          required
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <small className="meta">
          Si todavía no tiene usuario, le enviamos un e-mail para que elija su
          contraseña.
        </small>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={deferred}
          onChange={(e) => setDeferred(e.target.checked)}
        />{' '}
        Puede pagar después (queda a su cuenta)
      </label>
    </FormDrawer>
  );
}
