import type {
  Product,
  ProductCategory,
  Sale,
  SaleItem,
} from '@centrocolor/domain';

export type PosMutableType = 'category' | 'product';
export type PosEntityType = PosMutableType | 'sale';
export type PosMutable = Product | ProductCategory;
export interface PosCursor {
  updatedAt: string;
  id: string;
}
export interface PendingPosChange {
  outboxId: string;
  entityType: PosMutableType;
  entity: PosMutable;
  localRevision: number;
  cloudUpdatedAt: string | null;
}
export interface SaleBundle {
  sale: Sale;
  items: SaleItem[];
}
export interface PendingSale {
  outboxId: string;
  bundle: SaleBundle;
}
export interface PosSyncLocalPort {
  pending(
    type: PosMutableType,
    businessId: string,
    limit: number,
  ): Promise<PendingPosChange[]>;
  pendingFor(
    type: PosMutableType,
    businessId: string,
    id: string,
  ): Promise<PendingPosChange | null>;
  acknowledge(change: PendingPosChange, cloud: PosMutable): Promise<void>;
  fail(change: PendingPosChange | PendingSale, message: string): Promise<void>;
  conflict(change: PendingPosChange, cloud: PosMutable): Promise<void>;
  applyRemote(type: PosMutableType, entity: PosMutable): Promise<boolean>;
  cursor(type: PosEntityType, businessId: string): Promise<PosCursor | null>;
  advanceCursor(
    type: PosEntityType,
    businessId: string,
    cursor: PosCursor,
  ): Promise<void>;
  pendingSales(businessId: string, limit: number): Promise<PendingSale[]>;
  acknowledgeSale(change: PendingSale): Promise<void>;
  applyRemoteSale(bundle: SaleBundle): Promise<void>;
}
export interface PosSyncCloudPort {
  push(
    type: PosMutableType,
    change: PendingPosChange,
  ): Promise<{ kind: 'pushed' | 'conflict'; entity: PosMutable }>;
  pull(
    type: PosMutableType,
    businessId: string,
    after: PosCursor | null,
    limit: number,
  ): Promise<PosMutable[]>;
  pushSale(bundle: SaleBundle): Promise<void>;
  pullSales(
    businessId: string,
    after: PosCursor | null,
    limit: number,
  ): Promise<SaleBundle[]>;
}
export interface PosSyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
}

const pageSize = 100;
const cycleLimit = 1000;

function compareCursor(a: PosCursor, b: PosCursor): number {
  const time = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  if (time !== 0) return time;
  const fractionA = (a.updatedAt.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0');
  const fractionB = (b.updatedAt.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0');
  if (fractionA !== fractionB) return fractionA < fractionB ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

function assertBusiness(businessId: string, actual: string) {
  if (businessId !== actual)
    throw new Error('Sync devolvió datos de otro negocio.');
}

export async function syncPosMutable(
  type: PosMutableType,
  businessId: string,
  local: PosSyncLocalPort,
  cloud: PosSyncCloudPort,
): Promise<PosSyncResult> {
  const result = { pushed: 0, pulled: 0, conflicts: 0 };
  let processed = 0;
  while (processed < cycleLimit) {
    const pending = await local.pending(
      type,
      businessId,
      Math.min(pageSize, cycleLimit - processed),
    );
    if (!pending.length) break;
    for (const change of pending) {
      assertBusiness(businessId, change.entity.businessId);
      try {
        const response = await cloud.push(type, change);
        assertBusiness(businessId, response.entity.businessId);
        if (response.kind === 'conflict') {
          await local.conflict(change, response.entity);
          result.conflicts++;
        } else {
          await local.acknowledge(change, response.entity);
          result.pushed++;
        }
      } catch (error) {
        await local.fail(
          change,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
      processed++;
    }
    if (pending.length < pageSize) break;
  }
  let cursor = await local.cursor(type, businessId);
  processed = 0;
  while (processed < cycleLimit) {
    const page = await cloud.pull(
      type,
      businessId,
      cursor,
      Math.min(pageSize, cycleLimit - processed),
    );
    if (!page.length) break;
    for (const entity of page) {
      assertBusiness(businessId, entity.businessId);
      const next = { updatedAt: entity.updatedAt, id: entity.id };
      if (cursor && compareCursor(next, cursor) <= 0)
        throw new Error('Cursor POS no creciente.');
      const pending = await local.pendingFor(type, businessId, entity.id);
      if (pending) {
        if (pending.cloudUpdatedAt !== entity.updatedAt) {
          await local.conflict(pending, entity);
          result.conflicts++;
        }
      } else if (await local.applyRemote(type, entity)) {
        result.pulled++;
      } else {
        const raced = await local.pendingFor(type, businessId, entity.id);
        if (!raced)
          throw new Error('No se pudo aplicar el cambio POS en SQLite.');
        if (raced.cloudUpdatedAt !== entity.updatedAt) {
          await local.conflict(raced, entity);
          result.conflicts++;
        }
      }
      await local.advanceCursor(type, businessId, next);
      cursor = next;
      processed++;
    }
    if (page.length < pageSize) break;
  }
  return result;
}

export async function syncPosSales(
  businessId: string,
  local: PosSyncLocalPort,
  cloud: PosSyncCloudPort,
): Promise<PosSyncResult> {
  const result = { pushed: 0, pulled: 0, conflicts: 0 };
  let processed = 0;
  while (processed < cycleLimit) {
    const pending = await local.pendingSales(
      businessId,
      Math.min(pageSize, cycleLimit - processed),
    );
    if (!pending.length) break;
    for (const change of pending) {
      assertBusiness(businessId, change.bundle.sale.businessId);
      try {
        await cloud.pushSale(change.bundle);
        await local.acknowledgeSale(change);
        result.pushed++;
      } catch (error) {
        await local.fail(
          change,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
      processed++;
    }
    if (pending.length < pageSize) break;
  }
  let cursor = await local.cursor('sale', businessId);
  processed = 0;
  while (processed < cycleLimit) {
    const page = await cloud.pullSales(
      businessId,
      cursor,
      Math.min(pageSize, cycleLimit - processed),
    );
    if (!page.length) break;
    for (const bundle of page) {
      assertBusiness(businessId, bundle.sale.businessId);
      if (!bundle.items.length)
        throw new Error('Cloud devolvió una venta sin líneas.');
      const next = { updatedAt: bundle.sale.updatedAt, id: bundle.sale.id };
      if (cursor && compareCursor(next, cursor) <= 0)
        throw new Error('Cursor de ventas no creciente.');
      await local.applyRemoteSale(bundle);
      await local.advanceCursor('sale', businessId, next);
      cursor = next;
      result.pulled++;
      processed++;
    }
    if (page.length < pageSize) break;
  }
  return result;
}
