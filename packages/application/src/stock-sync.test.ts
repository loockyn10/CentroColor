import { describe, expect, it } from 'vitest';
import type { StockMovement } from '@centrocolor/domain';
import {
  syncStockMovements,
  type StockCursor,
  type StockSyncCloudPort,
  type StockSyncLocalPort,
} from './stock-sync';

const movement = (
  id: string,
  delta: number,
  receivedAt: string | null = null,
): StockMovement => ({
  id,
  businessId: 'business',
  branchId: 'branch',
  productId: 'product',
  movementType: 'entry',
  quantityDelta: delta,
  saleId: null,
  saleItemId: null,
  note: null,
  createdBy: 'user',
  deviceId: null,
  occurredAt: '2026-09-21T10:00:00Z',
  receivedAt,
});

class Local implements StockSyncLocalPort {
  rows = new Map<string, StockMovement>();
  outbox = new Set<string>();
  position: StockCursor | null = null;
  pending() {
    return Promise.resolve([...this.outbox].map((id) => this.rows.get(id)!));
  }
  acknowledge(item: StockMovement, cloud: StockMovement) {
    this.rows.set(item.id, cloud);
    this.outbox.delete(item.id);
    return Promise.resolve();
  }
  fail() {
    return Promise.resolve();
  }
  cursor() {
    return Promise.resolve(this.position);
  }
  applyRemote(item: StockMovement) {
    const local = this.rows.get(item.id);
    if (local && local.quantityDelta !== item.quantityDelta)
      throw new Error('UUID diferente');
    this.rows.set(item.id, item);
    return Promise.resolve();
  }
  advanceCursor(_businessId: string, position: StockCursor) {
    this.position = position;
    return Promise.resolve();
  }
  balance() {
    return [...this.rows.values()].reduce(
      (sum, item) => sum + item.quantityDelta,
      0,
    );
  }
}

class Cloud implements StockSyncCloudPort {
  rows = new Map<string, StockMovement>();
  push(item: StockMovement) {
    const existing = this.rows.get(item.id);
    if (existing) return Promise.resolve(existing);
    const saved = { ...item, receivedAt: '2026-09-21T12:00:00.000001Z' };
    this.rows.set(item.id, saved);
    return Promise.resolve(saved);
  }
  pull(_businessId: string, after: StockCursor | null) {
    return Promise.resolve(
      [...this.rows.values()]
        .sort((a, b) => a.receivedAt!.localeCompare(b.receivedAt!))
        .filter(
          (item) =>
            !after ||
            item.receivedAt! > after.receivedAt ||
            (item.receivedAt === after.receivedAt && item.id > after.id),
        ),
    );
  }
  balance() {
    return [...this.rows.values()].reduce(
      (sum, item) => sum + item.quantityDelta,
      0,
    );
  }
}

describe('sync de movimientos', () => {
  it('sube el mismo UUID, incorpora movimientos Web y converge en reintentos', async () => {
    const local = new Local();
    const cloud = new Cloud();
    local.rows.set('local', movement('local', 10));
    local.outbox.add('local');
    cloud.rows.set('web', movement('web', -2, '2026-09-21T12:00:00.000002Z'));
    await syncStockMovements('business', local, cloud);
    expect(local.outbox.size).toBe(0);
    expect(local.rows.get('local')?.id).toBe(cloud.rows.get('local')?.id);
    expect(local.balance()).toBe(8);
    expect(cloud.balance()).toBe(8);
    await syncStockMovements('business', local, cloud);
    expect(local.rows.size).toBe(2);
    expect(cloud.rows.size).toBe(2);
    expect(local.outbox.size).toBe(0);
  });
});
