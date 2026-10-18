import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  getCustomer,
  postWorkPayment,
  voidWorkPayment,
  type CustomerRepository,
  type WorkPaymentRepository,
} from '@centrocolor/application';
import {
  workPaymentMethods,
  type CustomerWorkAccount,
  type WorkAccount,
  type WorkPaymentKind,
  type WorkPaymentMethod,
  type WorkPaymentSourceType,
} from '@centrocolor/domain';
import { Button, Card, EmptyState, Icon, Sheet } from '@centrocolor/ui';
import { useBusinessContext } from './auth';
import { shortDateTime } from './format';

const money = (x: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(
    x / 100,
  );
const kindLabel: Record<string, string> = {
  deposit: 'Seña',
  payment: 'Pago',
  refund: 'Devolución',
};
const methodLabel: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  debit_card: 'Débito',
  credit_card: 'Crédito',
  mercado_pago: 'Mercado Pago',
  other: 'Otro',
};
const sourceLabel: Record<string, string> = {
  event: 'Evento',
  frame_job: 'Marquetería',
  photo_job: 'Fotografía',
};
const parseAmount = (value: string) => {
  const clean = value.trim();
  const normalized = clean.includes(',')
    ? clean.replace(/\./g, '').replace(',', '.')
    : clean;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error('Ingresá un monto mayor a cero.');
  return Math.round(n * 100);
};
const localDateTime = (date = new Date()) => {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return copy.toISOString().slice(0, 16);
};

export function PaymentAccountPanel({
  repository,
  sourceType,
  sourceId,
  onMutation,
}: {
  repository: WorkPaymentRepository;
  sourceType: WorkPaymentSourceType;
  sourceId: string;
  onMutation?: () => void;
}) {
  const context = useBusinessContext();
  const [account, setAccount] = useState<WorkAccount | null>(null),
    [kind, setKind] = useState<WorkPaymentKind | null>(null),
    [amount, setAmount] = useState(''),
    [method, setMethod] = useState<WorkPaymentMethod>('cash'),
    [occurred, setOccurred] = useState(localDateTime()),
    [notes, setNotes] = useState(''),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const load = () =>
    repository
      .getAccount(context.businessId, sourceType, sourceId)
      .then(setAccount)
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : 'No se pudo cargar la cuenta.',
        ),
      );
  useEffect(() => {
    void load();
  }, [repository, context.businessId, sourceType, sourceId, refresh]);
  const open = (next: WorkPaymentKind) => {
    setKind(next);
    setAmount(
      ((next === 'refund' ? account?.paidCents : account?.balanceCents) ?? 0) /
        100 +
        '',
    );
    setOccurred(localDateTime());
    setNotes('');
    setError(null);
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!account || !kind) return;
    setBusy(true);
    setError(null);
    try {
      await postWorkPayment(repository, {
        businessId: context.businessId,
        branchId: context.branchId!,
        customerId: account.customerId,
        sourceType,
        sourceId,
        paymentKind: kind,
        paymentMethod: method,
        amountCents: parseAmount(amount),
        occurredAt: new Date(occurred).toISOString(),
        notes,
        createdBy: context.userId,
      });
      setKind(null);
      setRefresh((x) => x + 1);
      onMutation?.();
    } catch (x) {
      setError(
        x instanceof Error ? x.message : 'No se pudo registrar el pago.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function voidPayment(id: string) {
    const reason = window.prompt('Motivo obligatorio de la anulación:');
    if (reason === null) return;
    setBusy(true);
    setError(null);
    try {
      await voidWorkPayment(
        repository,
        context.businessId,
        id,
        context.userId,
        reason,
      );
      setRefresh((x) => x + 1);
      onMutation?.();
    } catch (x) {
      setError(x instanceof Error ? x.message : 'No se pudo anular el pago.');
    } finally {
      setBusy(false);
    }
  }
  if (!account)
    return (
      <Card className="work-account">
        <h3>Cuenta</h3>
        <p className="meta">{error ?? 'Cargando cuenta…'}</p>
      </Card>
    );
  const cancelled = account.sourceStatus === 'cancelled';
  return (
    <Card className="work-account">
      <div className="work-account-heading">
        <h3>Cuenta</h3>
        {account.balanceCents === 0 && (
          <span className="state-line">
            <span className="tone-ok">Pagado</span>
          </span>
        )}
      </div>
      <dl className="account-totals">
        <div>
          <dt>Total</dt>
          <dd>{money(account.totalCents)}</dd>
        </div>
        <div>
          <dt>Pagado</dt>
          <dd>{money(account.paidCents)}</dd>
        </div>
        <div className={account.balanceCents > 0 ? 'is-due' : undefined}>
          <dt>Saldo</dt>
          <dd>{money(account.balanceCents)}</dd>
        </div>
      </dl>
      {cancelled && account.paidCents > 0 && (
        <p className="work-cancel-warning">
          CANCELADO — tiene {money(account.paidCents)} recibidos pendientes de
          resolución/devolución
        </p>
      )}
      {error && (
        <p className="appointment-error" role="alert">
          {error}
        </p>
      )}
      <div className="work-payment-actions">
        <Button
          variant="primary"
          disabled={busy || account.balanceCents <= 0}
          onClick={() => open('payment')}
        >
          Registrar pago
        </Button>
        <Button
          disabled={busy || account.balanceCents <= 0}
          onClick={() => open('deposit')}
        >
          Registrar seña
        </Button>
        <Button
          variant="ghost"
          disabled={busy || account.paidCents <= 0}
          onClick={() => open('refund')}
        >
          Registrar devolución
        </Button>
      </div>
      {kind && (
        <form className="work-payment-form" onSubmit={(e) => void submit(e)}>
          <h4>Registrar {kindLabel[kind].toLowerCase()}</h4>
          <p className="meta">
            Total {money(account.totalCents)} · Ya pagado{' '}
            {money(account.paidCents)} · Saldo {money(account.balanceCents)}
          </p>
          <label>
            Monto
            <input
              autoFocus
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Medio
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as WorkPaymentMethod)}
            >
              {workPaymentMethods.map((x) => (
                <option key={x} value={x}>
                  {methodLabel[x]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fecha/hora
            <input
              required
              type="datetime-local"
              value={occurred}
              onChange={(e) => setOccurred(e.target.value)}
            />
          </label>
          <label>
            Nota
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div>
            <button className="customer-primary" disabled={busy}>
              Confirmar
            </button>
            <button type="button" onClick={() => setKind(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      <div className="work-payment-history">
        <h4>Historial</h4>
        {account.payments.length === 0 ? (
          <p className="meta">Sin movimientos.</p>
        ) : (
          account.payments.map((x) => {
            const conflict = account.conflictPaymentIds.includes(x.id);
            return (
              <div
                className={`work-payment-row ${x.status === 'voided' ? 'is-voided' : ''} ${conflict ? 'is-conflict' : ''}`}
                key={x.id}
              >
                <span>{new Date(x.occurredAt).toLocaleString('es-AR')}</span>
                <span>{kindLabel[x.paymentKind]}</span>
                <span>{methodLabel[x.paymentMethod]}</span>
                <b>
                  {x.paymentKind === 'refund' ? '-' : ''}
                  {money(x.amountCents)}
                </b>
                <span>
                  {conflict
                    ? 'Conflicto Cloud'
                    : x.status === 'voided'
                      ? 'Anulado'
                      : 'Registrado'}
                </span>
                {x.status === 'voided' ? (
                  <small>{x.voidReason}</small>
                ) : (
                  context.role !== 'staff' && (
                    <button
                      disabled={busy}
                      onClick={() => void voidPayment(x.id)}
                    >
                      {conflict ? 'Descartar conflicto' : 'Anular'}
                    </button>
                  )
                )}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

export function CustomerAccountPanel({
  repository,
  customerId,
  refreshToken,
}: {
  repository: WorkPaymentRepository;
  customerId: string;
  refreshToken?: number;
}) {
  const c = useBusinessContext();
  const [account, setAccount] = useState<CustomerWorkAccount | null>(null);
  useEffect(() => {
    repository
      .getCustomerAccount(c.businessId, customerId)
      .then(setAccount)
      .catch(() => setAccount(null));
  }, [repository, c.businessId, customerId, refreshToken]);
  if (!account)
    return (
      <Card className="customer-account">
        <h3>Cuenta</h3>
        <p className="meta">Cargando…</p>
      </Card>
    );
  return (
    <Card className="customer-account">
      <div className="work-account-heading">
        <h3>Cuenta</h3>
        <strong className={account.balanceCents > 0 ? 'txt-warn' : 'txt-ok'}>
          {account.balanceCents > 0
            ? `Saldo ${money(account.balanceCents)}`
            : 'Sin saldo'}
        </strong>
      </div>
      {account.sources.map((x) => (
        <div
          className="customer-account-source"
          key={`${x.sourceType}-${x.sourceId}`}
        >
          <span>
            {sourceLabel[x.sourceType]} · {x.description}
          </span>
          <small>{sourceStatusLabel[x.sourceStatus] ?? x.sourceStatus}</small>
          <span>
            Total {money(x.totalCents)} · Pagado {money(x.paidCents)} ·{' '}
            <b>Saldo {money(x.balanceCents)}</b>
          </span>
        </div>
      ))}
      {account.recentPayments.length > 0 && (
        <>
          <h4>Pagos recientes</h4>
          {account.recentPayments.slice(0, 8).map((x) => (
            <small className="block" key={x.id}>
              {new Date(x.occurredAt).toLocaleDateString('es-AR')} ·{' '}
              {kindLabel[x.paymentKind]} · {money(x.amountCents)} ·{' '}
              {x.status === 'voided' ? 'Anulado' : 'Registrado'}
            </small>
          ))}
        </>
      )}
    </Card>
  );
}

const sourceStatusLabel: Record<string, string> = {
  received: 'Recibido',
  pending: 'Pendiente',
  in_progress: 'En proceso',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  inquiry: 'Consulta',
  quoted: 'Presupuestado',
  reserved: 'Reservado',
  completed: 'Realizado',
};
const finishedStatuses = new Set(['ready', 'completed', 'delivered']);

type Scope = 'all' | 'finished' | WorkPaymentSourceType;

/** Cobros: bandeja compacta de cuentas con saldo. Cobrar abre la cuenta real (WorkPayment). */
export function CobrosPage({
  repository,
  customerRepository,
  refreshToken,
  onMutation,
}: {
  repository: WorkPaymentRepository;
  customerRepository: CustomerRepository;
  refreshToken?: number;
  onMutation?: () => void;
}) {
  const c = useBusinessContext();
  const [accounts, setAccounts] = useState<WorkAccount[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<Scope>('all');
  const [open, setOpen] = useState<WorkAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (c.role === 'staff' || !c.branchId) return;
    let live = true;
    repository
      .listOutstanding(c.businessId, c.branchId)
      .then(async (rows) => {
        if (!live) return;
        setAccounts(rows);
        setError(null);
        const ids = [...new Set(rows.map((row) => row.customerId))];
        const found = await Promise.all(
          ids.map((id) =>
            getCustomer(customerRepository, c.businessId, id).catch(() => null),
          ),
        );
        if (live)
          setNames(
            Object.fromEntries(
              found.flatMap((x) => (x ? [[x.id, x.fullName]] : [])),
            ),
          );
      })
      .catch((e) => {
        if (live)
          setError(
            e instanceof Error
              ? e.message
              : 'No se pudieron cargar los cobros.',
          );
      });
    return () => {
      live = false;
    };
  }, [
    repository,
    customerRepository,
    c.businessId,
    c.branchId,
    c.role,
    refresh,
    refreshToken,
  ]);

  const sorted = useMemo(
    () =>
      [...(accounts ?? [])].sort(
        (a, b) =>
          Number(finishedStatuses.has(b.sourceStatus)) -
            Number(finishedStatuses.has(a.sourceStatus)) ||
          b.balanceCents - a.balanceCents,
      ),
    [accounts],
  );
  const visible = sorted.filter((row) =>
    scope === 'all'
      ? true
      : scope === 'finished'
        ? finishedStatuses.has(row.sourceStatus)
        : row.sourceType === scope,
  );
  const count = (predicate: (row: WorkAccount) => boolean) =>
    sorted.filter(predicate).length;
  const totalDue = sorted.reduce((sum, row) => sum + row.balanceCents, 0);

  if (c.role === 'staff')
    return (
      <>
        <header className="page-head">
          <h1>Cobros</h1>
        </header>
        <Card>
          <EmptyState icon="lock" title="Sólo owner y admin ven los cobros">
            Registrá pagos desde la ficha de cada trabajo.
          </EmptyState>
        </Card>
      </>
    );

  const chips: Array<[Scope, string, number]> = [
    ['all', 'Todos', sorted.length],
    [
      'finished',
      'Terminados',
      count((r) => finishedStatuses.has(r.sourceStatus)),
    ],
    ['photo_job', 'Fotografía', count((r) => r.sourceType === 'photo_job')],
    ['frame_job', 'Marquetería', count((r) => r.sourceType === 'frame_job')],
    ['event', 'Eventos', count((r) => r.sourceType === 'event')],
  ];

  return (
    <>
      <header className="page-head">
        <h1>Cobros</h1>
        {sorted.length > 0 && (
          <p className="meta page-meta">
            {sorted.length} con saldo · <strong>{money(totalDue)}</strong> por
            cobrar
          </p>
        )}
      </header>
      {error && (
        <p className="customer-error" role="alert">
          {error}
        </p>
      )}
      <div
        className="chips toolbar-row"
        role="group"
        aria-label="Filtrar cobros"
      >
        {chips.map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            className="chip"
            aria-pressed={scope === id}
            onClick={() => setScope(id)}
          >
            {label} <span className="count">{n}</span>
          </button>
        ))}
      </div>
      <Card className="card--flush">
        {accounts === null ? (
          <p className="pad meta">Cargando cobros…</p>
        ) : visible.length === 0 ? (
          <EmptyState icon="wallet" title="Sin saldos pendientes" />
        ) : (
          <div className="rows">
            {visible.map((row) => {
              const finished = finishedStatuses.has(row.sourceStatus);
              const last = row.payments
                .filter((p) => p.status === 'posted')
                .at(-1);
              return (
                <div
                  className="oprow"
                  data-flag={finished ? 'warn' : undefined}
                  key={`${row.sourceType}-${row.sourceId}`}
                >
                  <span className="who">
                    {names[row.customerId] ?? 'Cliente'}
                  </span>
                  <span className="what">
                    <span className="meta">{sourceLabel[row.sourceType]}</span>{' '}
                    {row.description}
                  </span>
                  <span className="when">
                    <strong className="num">{money(row.balanceCents)}</strong>
                    <span className="meta">
                      de {money(row.totalCents)}
                      {last
                        ? ` · último pago ${shortDateTime(last.occurredAt)}`
                        : ''}
                    </span>
                  </span>
                  <span className="act">
                    <span className="state-line">
                      <span className={finished ? 'tone-warn' : undefined}>
                        {sourceStatusLabel[row.sourceStatus] ??
                          row.sourceStatus}
                      </span>
                    </span>
                    <Button
                      variant={finished ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => setOpen(row)}
                    >
                      Cobrar
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <Sheet
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? (names[open.customerId] ?? 'Cuenta') : 'Cuenta'}
        variant="side"
      >
        {open && (
          <>
            <p className="meta">
              <Icon name="receipt" size={18} /> {sourceLabel[open.sourceType]} ·{' '}
              {open.description}
            </p>
            <PaymentAccountPanel
              repository={repository}
              sourceType={open.sourceType}
              sourceId={open.sourceId}
              onMutation={() => {
                setRefresh((x) => x + 1);
                onMutation?.();
              }}
            />
          </>
        )}
      </Sheet>
    </>
  );
}
