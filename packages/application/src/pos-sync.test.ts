import { describe, expect, it } from 'vitest';
import type { Product, ProductCategory, Sale } from '@centrocolor/domain';
import {
  syncPosMutable,
  syncPosSales,
  type PendingPosChange,
  type PendingSale,
  type PosCursor,
  type PosEntityType,
  type PosMutable,
  type PosMutableType,
  type PosSyncCloudPort,
  type PosSyncLocalPort,
  type SaleBundle,
} from './pos-sync';

const t1 = '2026-09-20T10:00:00.000001+00:00';
const t2 = '2026-09-20T10:00:00.000002+00:00';
const category = (id: string, time = t1): ProductCategory => ({
  id,
  businessId: 'b',
  name: 'Marcos',
  isActive: true,
  createdAt: t1,
  updatedAt: time,
});
const product = (id: string, time = t1): Product => ({
  ...category(id, time),
  barcode: 'X',
  salePriceCents: 1000,
  costPriceCents: null,
  categoryId: null,
  tracksInventory: false,
});
const sale = (id: string, time = t1): Sale => ({
  id,
  businessId: 'b',
  branchId: 'branch',
  deviceId: null,
  createdBy: 'user',
  status: 'completed',
  subtotalCents: 1000,
  totalCents: 1000,
  paymentMethod: 'cash',
  createdAt: t1,
  updatedAt: time,
});
const bundle = (id: string, time = t1): SaleBundle => ({
  sale: sale(id, time),
  items: [
    {
      id: `item-${id}`,
      saleId: id,
      productId: 'p',
      productName: 'Original',
      barcode: 'X',
      unitPriceCents: 1000,
      quantity: 1,
      totalCents: 1000,
      lineTotalCents: 1000,
      tracksInventory: false,
    },
  ],
});

class MemoryLocal implements PosSyncLocalPort {
  rows = new Map<string, PosMutable>();
  changes = new Map<string, PendingPosChange>();
  sales = new Map<string, SaleBundle>();
  saleChanges = new Map<string, PendingSale>();
  cursors = new Map<PosEntityType, PosCursor>();
  conflicts = new Set<string>();
  errors: string[] = [];
  add(type: PosMutableType, entity: PosMutable) {
    this.rows.set(entity.id, entity);
    this.changes.set(entity.id, {
      outboxId: entity.id,
      entityType: type,
      entity,
      localRevision: 1,
      cloudUpdatedAt: null,
    });
  }
  async pending(type: PosMutableType, businessId: string, limit: number) {
    return [...this.changes.values()]
      .filter(
        (value) =>
          value.entityType === type &&
          value.entity.businessId === businessId &&
          !this.conflicts.has(value.entity.id),
      )
      .slice(0, limit);
  }
  async pendingFor(type: PosMutableType, _businessId: string, id: string) {
    const value = this.changes.get(id);
    return value?.entityType === type ? value : null;
  }
  async acknowledge(change: PendingPosChange, cloud: PosMutable) {
    this.rows.set(cloud.id, cloud);
    this.changes.delete(change.entity.id);
  }
  async fail(_change: PendingPosChange | PendingSale, message: string) {
    this.errors.push(message);
  }
  async conflict(change: PendingPosChange) {
    this.conflicts.add(change.entity.id);
  }
  async applyRemote(_type: PosMutableType, entity: PosMutable) {
    this.rows.set(entity.id, entity);
    return true;
  }
  async cursor(type: PosEntityType) {
    return this.cursors.get(type) ?? null;
  }
  async advanceCursor(
    type: PosEntityType,
    _businessId: string,
    cursor: PosCursor,
  ) {
    this.cursors.set(type, cursor);
  }
  async pendingSales(_businessId: string, limit: number) {
    return [...this.saleChanges.values()].slice(0, limit);
  }
  async acknowledgeSale(change: PendingSale) {
    this.saleChanges.delete(change.bundle.sale.id);
  }
  async applyRemoteSale(value: SaleBundle) {
    this.sales.set(value.sale.id, value);
  }
}

function cloud(overrides: Partial<PosSyncCloudPort> = {}): PosSyncCloudPort {
  return {
    push: async (_type, change) => ({
      kind: 'pushed',
      entity: { ...change.entity, updatedAt: t2 },
    }),
    pull: async () => [],
    pushSale: async () => {},
    pullSales: async () => [],
    ...overrides,
  };
}

describe('POS synchronization order and integrity', () => {
  it('pushes categories and products with stable IDs and does not loop after pull', async () => {
    const local = new MemoryLocal();
    local.add('category', category('c'));
    local.add('product', product('p'));
    const pushed: string[] = [];
    const remote = cloud({
      push: async (type, change) => {
        pushed.push(`${type}:${change.entity.id}`);
        return { kind: 'pushed', entity: { ...change.entity, updatedAt: t2 } };
      },
      pull: async (type) =>
        type === 'category' ? [category('web-c', t2)] : [product('web-p', t2)],
    });
    await syncPosMutable('category', 'b', local, remote);
    await syncPosMutable('product', 'b', local, remote);
    expect(pushed).toEqual(['category:c', 'product:p']);
    expect(local.rows.get('web-p')?.id).toBe('web-p');
    expect(local.changes.size).toBe(0);
    await syncPosMutable('product', 'b', local, cloud());
    expect(local.changes.size).toBe(0);
  });

  it('records a product conflict and preserves the local edit', async () => {
    const local = new MemoryLocal();
    local.add('product', product('p'));
    const other = { ...product('p', t2), name: 'Cambió en Web' };
    const result = await syncPosMutable(
      'product',
      'b',
      local,
      cloud({
        push: async () => ({ kind: 'conflict', entity: other }),
        pull: async () => [other],
      }),
    );
    expect(result.conflicts).toBeGreaterThan(0);
    expect(local.rows.get('p')?.name).toBe('Marcos');
    expect(local.changes.has('p')).toBe(true);
  });

  it('keeps the same sale bundle pending across failed pushes, then pulls a complete Cloud sale', async () => {
    const local = new MemoryLocal();
    const first = bundle('desktop');
    local.sales.set(first.sale.id, first);
    local.saleChanges.set(first.sale.id, { outboxId: 'outbox', bundle: first });
    await expect(
      syncPosSales(
        'b',
        local,
        cloud({
          pushSale: async () => {
            throw new Error('network');
          },
        }),
      ),
    ).rejects.toThrow('network');
    expect(local.saleChanges.has('desktop')).toBe(true);
    const pushed: SaleBundle[] = [];
    const result = await syncPosSales(
      'b',
      local,
      cloud({
        pushSale: async (value) => {
          pushed.push(value);
        },
        pullSales: async () => [bundle('web', t2)],
      }),
    );
    expect(result).toEqual({ pushed: 1, pulled: 1, conflicts: 0 });
    expect(pushed[0].items[0].productName).toBe('Original');
    expect(local.sales.get('web')?.items).toHaveLength(1);
    expect(local.saleChanges.size).toBe(0);
  });

  it('refuses to advance a cursor for an incomplete Cloud sale', async () => {
    const local = new MemoryLocal();
    await expect(
      syncPosSales(
        'b',
        local,
        cloud({ pullSales: async () => [{ sale: sale('bad'), items: [] }] }),
      ),
    ).rejects.toThrow('sin líneas');
    expect(local.cursors.has('sale')).toBe(false);
  });
});
