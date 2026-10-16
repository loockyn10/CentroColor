import { describe, expect, it } from 'vitest';
import {
  normalizeWorkPayment,
  requireVoidReason,
  workAccountTotals,
  type WorkPayment,
} from './index';

const base: WorkPayment = {
  id: 'p1',
  businessId: 'b',
  branchId: 'br',
  customerId: 'c',
  sourceType: 'event',
  eventId: 'e',
  frameJobId: null,
  photoJobId: null,
  paymentKind: 'deposit',
  paymentMethod: 'cash',
  amountCents: 3000,
  occurredAt: '2026-10-16T12:00:00Z',
  notes: null,
  status: 'posted',
  createdBy: 'u',
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  createdAt: '2026-10-16T12:00:00Z',
  updatedAt: '2026-10-16T12:00:00Z',
};
describe('work payments', () => {
  it('calculates deposits, payments, refunds and voids', () => {
    const totals = workAccountTotals(10000, [
      base,
      { ...base, id: 'p2', paymentKind: 'payment', amountCents: 7000 },
      { ...base, id: 'r', paymentKind: 'refund', amountCents: 2000 },
      {
        ...base,
        id: 'v',
        amountCents: 9999,
        status: 'voided',
        voidedAt: base.createdAt,
        voidedBy: 'u',
        voidReason: 'error',
      },
      {
        ...base,
        id: 'rv',
        paymentKind: 'refund',
        amountCents: 1000,
        status: 'voided',
        voidedAt: base.createdAt,
        voidedBy: 'u',
        voidReason: 'devolución errónea',
      },
    ]);
    expect(totals).toEqual({
      totalCents: 10000,
      grossPaidCents: 10000,
      refundedCents: 2000,
      paidCents: 8000,
      balanceCents: 2000,
    });
  });
  it('rejects overpayments and excessive refunds', () => {
    expect(() =>
      normalizeWorkPayment(
        { ...base, amountCents: 3001 },
        {
          totalCents: 10000,
          grossPaidCents: 7000,
          refundedCents: 0,
          paidCents: 7000,
          balanceCents: 3000,
        },
      ),
    ).toThrow(/saldo máximo/);
    expect(() =>
      normalizeWorkPayment(
        { ...base, paymentKind: 'refund', amountCents: 7001 },
        {
          totalCents: 10000,
          grossPaidCents: 7000,
          refundedCents: 0,
          paidCents: 7000,
          balanceCents: 3000,
        },
      ),
    ).toThrow(/devolución máxima/);
  });
  it('requires exactly one matching source and a void reason', () => {
    expect(() =>
      normalizeWorkPayment({ ...base, photoJobId: 'photo' }),
    ).toThrow(/exactamente una/);
    expect(() =>
      normalizeWorkPayment({ ...base, eventId: null, photoJobId: 'photo' }),
    ).toThrow(/tipo de fuente/);
    expect(() => requireVoidReason('   ')).toThrow(/obligatorio/);
  });
});
