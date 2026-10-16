import { describe, expect, it } from 'vitest';
import {
  syncWorkPayments,
  type WorkPaymentSyncCloudPort,
  type WorkPaymentSyncLocalPort,
} from './payment-sync';
import type { WorkPayment } from '@centrocolor/domain';
const p: WorkPayment = {
  id: 'p',
  businessId: 'b',
  branchId: 'br',
  customerId: 'c',
  sourceType: 'photo_job',
  eventId: null,
  frameJobId: null,
  photoJobId: 'j',
  paymentKind: 'payment',
  paymentMethod: 'cash',
  amountCents: 1000,
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
describe('work payment sync', () => {
  it('pushes idempotently and pulls without creating a loop', async () => {
    let acknowledged = 0,
      applied = 0,
      advanced = 0;
    const local: WorkPaymentSyncLocalPort = {
      pending: async () => [{ outboxId: 'o', payment: p, localRevision: 1 }],
      pendingFor: async () => null,
      acknowledge: async () => {
        acknowledged++;
      },
      fail: async () => {},
      applyRemote: async () => {
        applied++;
        return true;
      },
      cursor: async () => null,
      advanceCursor: async () => {
        advanced++;
      },
    };
    const cloud: WorkPaymentSyncCloudPort = {
      push: async () => p,
      pull: async () => [
        { ...p, id: 'remote', updatedAt: '2026-10-16T13:00:00Z' },
      ],
    };
    expect(await syncWorkPayments('b', local, cloud)).toEqual({
      pushed: 1,
      pulled: 1,
      conflicts: 0,
    });
    expect([acknowledged, applied, advanced]).toEqual([1, 1, 1]);
  });
  it('keeps an overpayment rejection as conflict', async () => {
    let conflict = false;
    const local: WorkPaymentSyncLocalPort = {
      pending: async () => [{ outboxId: 'o', payment: p, localRevision: 1 }],
      pendingFor: async () => null,
      acknowledge: async () => {},
      fail: async (_c, _m, isConflict) => {
        conflict = Boolean(isConflict);
      },
      applyRemote: async () => false,
      cursor: async () => null,
      advanceCursor: async () => {},
    };
    const cloud: WorkPaymentSyncCloudPort = {
      push: async () => {
        throw new Error('El importe supera el saldo máximo cobrable');
      },
      pull: async () => [],
    };
    expect(await syncWorkPayments('b', local, cloud)).toEqual({
      pushed: 0,
      pulled: 0,
      conflicts: 1,
    });
    expect(conflict).toBe(true);
  });
});
