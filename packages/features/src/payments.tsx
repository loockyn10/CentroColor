import { useEffect, useState, type FormEvent } from 'react';
import {
  postWorkPayment,
  voidWorkPayment,
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
import { Card } from '@centrocolor/ui';
import { useBusinessContext } from './auth';

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
        <h3>CUENTA</h3>
        <p>{error ?? 'Cargando cuenta…'}</p>
      </Card>
    );
  const cancelled = account.sourceStatus === 'cancelled';
  return (
    <Card className="work-account">
      <div className="work-account-heading">
        <h3>CUENTA</h3>
        {account.balanceCents === 0 && <b className="work-paid">PAGADO</b>}
      </div>
      <div className="work-account-totals">
        <span>
          Total <b>{money(account.totalCents)}</b>
        </span>
        <span>
          Pagado <b>{money(account.paidCents)}</b>
        </span>
        <span>
          Saldo <b>{money(account.balanceCents)}</b>
        </span>
      </div>
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
        <button
          disabled={busy || account.balanceCents <= 0}
          onClick={() => open('deposit')}
        >
          + Registrar seña
        </button>
        <button
          disabled={busy || account.balanceCents <= 0}
          onClick={() => open('payment')}
        >
          + Registrar pago
        </button>
        <button
          disabled={busy || account.paidCents <= 0}
          onClick={() => open('refund')}
        >
          + Registrar devolución
        </button>
      </div>
      {kind && (
        <form className="work-payment-form" onSubmit={(e) => void submit(e)}>
          <h4>Registrar {kindLabel[kind].toLowerCase()}</h4>
          <p>
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
          <p>Sin movimientos.</p>
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
      <Card>
        <h3>CUENTA</h3>
        <p>Cargando…</p>
      </Card>
    );
  return (
    <Card className="customer-account">
      <h3>CUENTA</h3>
      <h2>Saldo total {money(account.balanceCents)}</h2>
      {account.sources.map((x) => (
        <div
          className="customer-account-source"
          key={`${x.sourceType}-${x.sourceId}`}
        >
          <span>
            {sourceLabel[x.sourceType]} · {x.description}
          </span>
          <small>{x.sourceStatus}</small>
          <span>
            Total {money(x.totalCents)} · Pagado {money(x.paidCents)} ·{' '}
            <b>Saldo {money(x.balanceCents)}</b>
          </span>
        </div>
      ))}
      {!account.sources.length && <p>Sin saldos pendientes.</p>}
      <h4>Pagos recientes</h4>
      {account.recentPayments.slice(0, 8).map((x) => (
        <small key={x.id}>
          {new Date(x.occurredAt).toLocaleDateString('es-AR')} ·{' '}
          {kindLabel[x.paymentKind]} · {money(x.amountCents)} ·{' '}
          {x.status === 'voided' ? 'Anulado' : 'Registrado'}
        </small>
      ))}
    </Card>
  );
}

export function WorkPaymentsDashboard({
  repository,
  refreshToken,
}: {
  repository: WorkPaymentRepository;
  refreshToken?: number;
}) {
  const c = useBusinessContext();
  const [rows, setRows] = useState<WorkAccount[]>([]);
  useEffect(() => {
    if (c.role === 'staff') return;
    repository
      .listOutstanding(c.businessId, c.branchId!)
      .then(setRows)
      .catch(() => setRows([]));
  }, [repository, c.businessId, c.branchId, c.role, refreshToken]);
  if (c.role === 'staff') return null;
  const total = rows.reduce((s, x) => s + x.balanceCents, 0);
  return (
    <Card className="metric-card">
      <h2>Saldos de trabajos</h2>
      <div className="metric-value">{money(total)}</div>
      <p>{rows.length} trabajos con saldo</p>
      {rows.slice(0, 3).map((x) => (
        <small key={`${x.sourceType}-${x.sourceId}`}>
          {sourceLabel[x.sourceType]} · {x.description} ·{' '}
          {money(x.balanceCents)}
        </small>
      ))}
    </Card>
  );
}
