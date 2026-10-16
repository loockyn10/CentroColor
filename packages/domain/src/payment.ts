import { requireCents } from './product';

export const workPaymentSourceTypes = [
  'event',
  'frame_job',
  'photo_job',
] as const;
export const workPaymentKinds = ['deposit', 'payment', 'refund'] as const;
export const workPaymentMethods = [
  'cash',
  'transfer',
  'debit_card',
  'credit_card',
  'mercado_pago',
  'other',
] as const;
export const workPaymentStatuses = ['posted', 'voided'] as const;

export type WorkPaymentSourceType = (typeof workPaymentSourceTypes)[number];
export type WorkPaymentKind = (typeof workPaymentKinds)[number];
export type WorkPaymentMethod = (typeof workPaymentMethods)[number];
export type WorkPaymentStatus = (typeof workPaymentStatuses)[number];

export interface WorkPayment {
  id: string;
  businessId: string;
  branchId: string;
  customerId: string;
  sourceType: WorkPaymentSourceType;
  eventId: string | null;
  frameJobId: string | null;
  photoJobId: string | null;
  paymentKind: WorkPaymentKind;
  paymentMethod: WorkPaymentMethod;
  amountCents: number;
  occurredAt: string;
  notes: string | null;
  status: WorkPaymentStatus;
  createdBy: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkAccountTotals {
  totalCents: number;
  grossPaidCents: number;
  refundedCents: number;
  paidCents: number;
  balanceCents: number;
}

export interface WorkAccount extends WorkAccountTotals {
  sourceType: WorkPaymentSourceType;
  sourceId: string;
  customerId: string;
  description: string;
  sourceStatus: string;
  payments: WorkPayment[];
  conflictPaymentIds: string[];
}

export interface CustomerWorkAccount {
  customerId: string;
  balanceCents: number;
  sources: WorkAccount[];
  recentPayments: WorkPayment[];
}

export const workPaymentSourceId = (
  payment: Pick<
    WorkPayment,
    'sourceType' | 'eventId' | 'frameJobId' | 'photoJobId'
  >,
) => {
  const ids = [payment.eventId, payment.frameJobId, payment.photoJobId].filter(
    Boolean,
  );
  if (ids.length !== 1)
    throw new Error('El pago debe tener exactamente una fuente.');
  const expected =
    payment.sourceType === 'event'
      ? payment.eventId
      : payment.sourceType === 'frame_job'
        ? payment.frameJobId
        : payment.photoJobId;
  if (!expected)
    throw new Error('El tipo de fuente no coincide con su referencia.');
  return expected;
};

export function workAccountTotals(
  totalCents: number,
  payments: WorkPayment[],
): WorkAccountTotals {
  const total = requireCents(totalCents);
  let grossPaidCents = 0;
  let refundedCents = 0;
  for (const payment of payments) {
    if (payment.status === 'voided') continue;
    const amount = requireCents(payment.amountCents);
    if (payment.paymentKind === 'refund') refundedCents += amount;
    else grossPaidCents += amount;
  }
  const paidCents = grossPaidCents - refundedCents;
  const balanceCents = total - paidCents;
  if (
    ![grossPaidCents, refundedCents, paidCents, balanceCents].every(
      Number.isSafeInteger,
    )
  )
    throw new Error('El saldo está fuera de rango.');
  return {
    totalCents: total,
    grossPaidCents,
    refundedCents,
    paidCents,
    balanceCents,
  };
}

export function normalizeWorkPayment(
  payment: WorkPayment,
  current?: WorkAccountTotals,
): WorkPayment {
  workPaymentSourceId(payment);
  if (!(workPaymentKinds as readonly string[]).includes(payment.paymentKind))
    throw new Error('Tipo de pago inválido.');
  if (
    !(workPaymentMethods as readonly string[]).includes(payment.paymentMethod)
  )
    throw new Error('Medio de pago inválido.');
  const amountCents = requireCents(payment.amountCents);
  if (amountCents === 0) throw new Error('El importe debe ser mayor a cero.');
  if (!Number.isFinite(Date.parse(payment.occurredAt)))
    throw new Error('Fecha y hora inválidas.');
  if (current) {
    if (payment.paymentKind === 'refund' && amountCents > current.paidCents)
      throw new Error(`La devolución máxima es ${current.paidCents} centavos.`);
    if (payment.paymentKind !== 'refund' && amountCents > current.balanceCents)
      throw new Error(
        `El saldo máximo cobrable es ${current.balanceCents} centavos.`,
      );
  }
  return {
    ...payment,
    amountCents,
    occurredAt: new Date(payment.occurredAt).toISOString(),
    notes: payment.notes?.trim() || null,
  };
}

export function requireVoidReason(value: string) {
  const reason = value.trim();
  if (!reason) throw new Error('El motivo de anulación es obligatorio.');
  return reason;
}
