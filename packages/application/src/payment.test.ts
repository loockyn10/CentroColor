import { describe, expect, it } from 'vitest';
import type { WorkAccount, WorkPayment } from '@centrocolor/domain';
import { postWorkPayment, type WorkPaymentRepository } from './payment';

const account = (over: Partial<WorkAccount> = {}): WorkAccount => ({
  sourceType: 'photo_job',
  sourceId: 'job',
  customerId: 'c',
  description: 'Trabajo fotográfico',
  sourceStatus: 'received',
  payments: [],
  conflictPaymentIds: [],
  totalCents: 0,
  grossPaidCents: 0,
  refundedCents: 0,
  paidCents: 0,
  balanceCents: 0,
  ...over,
});

const repository = (value: WorkAccount | null) => {
  const posted: WorkPayment[] = [];
  const repo = {
    getAccount: async () => value,
    post: async (payment: WorkPayment) => {
      posted.push(payment);
      return payment;
    },
  } as unknown as WorkPaymentRepository;
  return { repo, posted };
};

const input = {
  businessId: 'b',
  branchId: 'br',
  customerId: 'c',
  sourceType: 'photo_job' as const,
  sourceId: 'job',
  paymentKind: 'payment' as const,
  paymentMethod: 'cash' as const,
  amountCents: 100,
  occurredAt: '2026-11-08T12:00:00Z',
  notes: null,
  createdBy: 'u',
};

describe('cobro de un pedido pendiente de presupuestar', () => {
  it('no se cobra: el cero de relleno no es un importe', async () => {
    const { repo, posted } = repository(account({ pendingQuote: true }));
    await expect(postWorkPayment(repo, input)).rejects.toThrow(
      /pendiente de presupuestar/,
    );
    expect(posted).toHaveLength(0);
  });

  it('presupuestado, se cobra como siempre', async () => {
    const { repo, posted } = repository(
      account({ totalCents: 1000, balanceCents: 1000 }),
    );
    await postWorkPayment(repo, input);
    expect(posted).toHaveLength(1);
  });

  it('una fuente que no es un pedido fotográfico no consulta el estado de presupuesto', async () => {
    const { repo, posted } = repository(account({ pendingQuote: true }));
    await postWorkPayment(repo, {
      ...input,
      sourceType: 'event',
      sourceId: 'event',
    });
    expect(posted).toHaveLength(1);
  });
});
