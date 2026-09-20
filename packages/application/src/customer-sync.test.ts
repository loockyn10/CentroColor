import { describe, expect, it } from 'vitest';
import type { Customer } from '@centrocolor/domain';
import {
  syncCustomers,
  type CustomerCursor,
  type CustomerSyncCloudPort,
  type CustomerSyncLocalPort,
  type PendingCustomerChange,
} from './customer-sync';

const time1 = '2026-09-20T10:00:00.000001+00:00';
const time2 = '2026-09-20T10:00:00.000002+00:00';

function customer(
  id: string,
  businessId = 'business-a',
  updatedAt = time1,
): Customer {
  return {
    id,
    businessId,
    fullName: `Cliente ${id}`,
    phone: null,
    email: null,
    documentNumber: null,
    notes: null,
    isActive: true,
    createdAt: time1,
    updatedAt,
  };
}

class MemoryLocal implements CustomerSyncLocalPort {
  rows = new Map<string, Customer>();
  changes = new Map<string, PendingCustomerChange>();
  conflicts = new Set<string>();
  errors: string[] = [];
  currentCursor: CustomerCursor | null = null;

  addLocal(value: Customer, cloudUpdatedAt: string | null = null) {
    this.rows.set(value.id, value);
    this.changes.set(value.id, {
      outboxId: value.id,
      customer: value,
      cloudUpdatedAt,
      localRevision: 1,
    });
  }
  async pending(businessId: string, limit: number) {
    return [...this.changes.values()]
      .filter(
        (change) =>
          change.customer.businessId === businessId &&
          !this.conflicts.has(change.customer.id),
      )
      .slice(0, limit);
  }
  async acknowledge(change: PendingCustomerChange, cloud: Customer) {
    this.rows.set(cloud.id, cloud);
    this.changes.delete(change.customer.id);
  }
  async fail(_change: PendingCustomerChange, message: string) {
    this.errors.push(message);
  }
  async conflict(change: PendingCustomerChange) {
    this.conflicts.add(change.customer.id);
  }
  async pendingForCustomer(_businessId: string, customerId: string) {
    return this.changes.get(customerId) ?? null;
  }
  async applyRemote(value: Customer) {
    this.rows.set(value.id, value);
    return true;
  }
  async cursor() {
    return this.currentCursor;
  }
  async advanceCursor(_businessId: string, value: CustomerCursor) {
    this.currentCursor = value;
  }
}

describe('Customer synchronization', () => {
  it('pushes an offline customer with its original UUID and clears the pending change', async () => {
    const local = new MemoryLocal();
    local.addLocal(customer('same-uuid'));
    const cloud: CustomerSyncCloudPort = {
      push: async (change) => ({
        kind: 'pushed',
        customer: { ...change.customer, updatedAt: time2 },
      }),
      pull: async () => [],
    };
    expect(await syncCustomers('business-a', local, cloud)).toEqual({
      pushed: 1,
      pulled: 0,
      conflicts: 0,
    });
    expect(local.rows.get('same-uuid')?.id).toBe('same-uuid');
    expect(local.changes.size).toBe(0);
  });

  it('keeps an offline change pending after push fails', async () => {
    const local = new MemoryLocal();
    local.addLocal(customer('offline'));
    const cloud: CustomerSyncCloudPort = {
      push: async () => {
        throw new Error('Network unavailable');
      },
      pull: async () => [],
    };
    await expect(syncCustomers('business-a', local, cloud)).rejects.toThrow(
      'Network unavailable',
    );
    expect(local.changes.has('offline')).toBe(true);
    expect(local.rows.has('offline')).toBe(true);
    expect(local.errors).toEqual(['Network unavailable']);
  });

  it('pulls Cloud create, edit and deactivation without producing outbox entries', async () => {
    const local = new MemoryLocal();
    let remote = customer('from-web');
    const cloud: CustomerSyncCloudPort = {
      push: async () => {
        throw new Error('Unexpected push');
      },
      pull: async (_businessId, after) => (after ? [] : [remote]),
    };
    await syncCustomers('business-a', local, cloud);
    expect(local.rows.get('from-web')?.fullName).toBe('Cliente from-web');
    remote = {
      ...remote,
      fullName: 'Actualizado en Web',
      isActive: false,
      updatedAt: time2,
    };
    cloud.pull = async (_businessId, after) =>
      after?.updatedAt === time1 ? [remote] : [];
    await syncCustomers('business-a', local, cloud);
    expect(local.rows.get('from-web')).toMatchObject({
      fullName: 'Actualizado en Web',
      isActive: false,
    });
    expect(local.changes.size).toBe(0);
    expect(local.currentCursor).toEqual({ updatedAt: time2, id: 'from-web' });
  });

  it('records a conflict instead of overwriting a concurrent Web edit', async () => {
    const local = new MemoryLocal();
    local.addLocal({ ...customer('shared'), phone: 'local' }, time1);
    const remote = { ...customer('shared', 'business-a', time2), phone: 'web' };
    const cloud: CustomerSyncCloudPort = {
      push: async () => ({ kind: 'conflict', customer: remote }),
      pull: async (_businessId, after) => (after ? [] : [remote]),
    };
    await syncCustomers('business-a', local, cloud);
    expect(local.rows.get('shared')?.phone).toBe('local');
    expect(local.conflicts.has('shared')).toBe(true);
    expect(local.changes.has('shared')).toBe(true);
  });

  it('rejects a Cloud row from another business', async () => {
    const local = new MemoryLocal();
    const cloud: CustomerSyncCloudPort = {
      push: async () => {
        throw new Error('Unexpected push');
      },
      pull: async () => [customer('foreign', 'business-b')],
    };
    await expect(syncCustomers('business-a', local, cloud)).rejects.toThrow(
      'otro negocio',
    );
    expect(local.rows.size).toBe(0);
    expect(local.currentCursor).toBeNull();
  });
});
