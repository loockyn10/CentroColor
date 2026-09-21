import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import type {
  PendingPosChange,
  PendingSale,
  PosCursor,
  PosEntityType,
  PosMutable,
  PosMutableType,
  PosSyncLocalPort,
  SaleBundle,
} from '@centrocolor/application';
import type { Product } from '@centrocolor/domain';
import { SQLiteSaleRepository } from './sqlite-pos-repositories';

const database = () => Database.load('sqlite:centrocolor.db');
type Row = {
  id: string;
  business_id: string;
  name: string;
  barcode?: string | null;
  sale_price_cents?: number;
  cost_price_cents?: number | null;
  category_id?: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  cloud_updated_at: string | null;
  outbox_id?: string;
  local_revision: number;
};
type OutboxRow = {
  id: string;
  entity_id: string;
  entity_type: PosMutableType;
  local_revision: number;
  remote_snapshot: string | null;
  remote_updated_at: string | null;
  last_error: string | null;
};
const table = (type: PosMutableType) =>
  type === 'category' ? 'product_categories' : 'products';
function decode(type: PosMutableType, row: Row): PosMutable {
  const base = {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (type === 'category') return base;
  return {
    ...base,
    barcode: row.barcode ?? null,
    salePriceCents: row.sale_price_cents!,
    costPriceCents: row.cost_price_cents ?? null,
    categoryId: row.category_id ?? null,
  };
}
function pending(type: PosMutableType, row: Row): PendingPosChange {
  return {
    outboxId: row.outbox_id!,
    entityType: type,
    entity: decode(type, row),
    localRevision: row.local_revision,
    cloudUpdatedAt: row.cloud_updated_at,
  };
}
export interface PosSyncSummary {
  pending: number;
  conflicts: number;
  lastError: string | null;
}
export interface PosConflict {
  id: string;
  type: PosMutableType;
  name: string;
  localRevision: number;
  cloudUpdatedAt: string | null;
  localSummary: string;
  cloudSummary: string;
}

function describe(type: PosMutableType, entity: PosMutable): string {
  const status = entity.isActive ? 'activo' : 'inactivo';
  if (type === 'category') return `${entity.name} · ${status}`;
  const product = entity as Product;
  const money = (value: number) =>
    (value / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 });
  return `${product.name} · ${product.barcode ?? 'sin código'} · $${money(product.salePriceCents)} · ${product.costPriceCents === null ? 'sin costo' : `costo $${money(product.costPriceCents)}`} · categoría ${product.categoryId ?? 'ninguna'} · ${status}`;
}

export class SQLitePosSyncAdapter implements PosSyncLocalPort {
  private readonly saleRepository = new SQLiteSaleRepository();

  async pending(
    type: PosMutableType,
    businessId: string,
    limit: number,
  ): Promise<PendingPosChange[]> {
    const db = await database();
    const rows = await db.select<Row[]>(
      `SELECT t.*,o.id AS outbox_id,o.local_revision
      FROM pos_sync_outbox o JOIN ${table(type)} t ON t.id=o.entity_id AND t.business_id=o.business_id
      WHERE o.business_id=? AND o.entity_type=? AND o.status='pending'
      ORDER BY o.created_at,o.id LIMIT ?`,
      [businessId, type, limit],
    );
    return rows.map((row) => pending(type, row));
  }
  async pendingFor(
    type: PosMutableType,
    businessId: string,
    id: string,
  ): Promise<PendingPosChange | null> {
    const db = await database();
    const rows = await db.select<Row[]>(
      `SELECT t.*,o.id AS outbox_id,o.local_revision
      FROM pos_sync_outbox o JOIN ${table(type)} t ON t.id=o.entity_id AND t.business_id=o.business_id
      WHERE o.business_id=? AND o.entity_type=? AND o.entity_id=? LIMIT 1`,
      [businessId, type, id],
    );
    return rows[0] ? pending(type, rows[0]) : null;
  }
  async acknowledge(
    change: PendingPosChange,
    cloud: PosMutable,
  ): Promise<void> {
    const db = await database();
    await db.execute(
      `UPDATE ${table(change.entityType)} SET cloud_updated_at=?,
      updated_at=CASE WHEN local_revision=? THEN ? ELSE updated_at END
      WHERE business_id=? AND id=?`,
      [
        cloud.updatedAt,
        change.localRevision,
        cloud.updatedAt,
        change.entity.businessId,
        change.entity.id,
      ],
    );
    await db.execute(
      `DELETE FROM pos_sync_outbox WHERE id=? AND business_id=? AND entity_type=?
      AND entity_id=? AND local_revision=? AND status='pending'`,
      [
        change.outboxId,
        change.entity.businessId,
        change.entityType,
        change.entity.id,
        change.localRevision,
      ],
    );
  }
  async fail(
    change: PendingPosChange | PendingSale,
    message: string,
  ): Promise<void> {
    const db = await database();
    await db.execute(
      `UPDATE pos_sync_outbox SET attempts=attempts+1,last_error=? WHERE id=? AND status='pending'`,
      [message.slice(0, 500), change.outboxId],
    );
  }
  async conflict(change: PendingPosChange, cloud: PosMutable): Promise<void> {
    const db = await database();
    await db.execute(
      `UPDATE pos_sync_outbox SET status='conflict',last_error=?,
      remote_updated_at=?,remote_snapshot=? WHERE id=? AND business_id=? AND entity_type=?`,
      [
        'El catálogo también cambió en Cloud. Requiere resolución.',
        cloud.updatedAt,
        JSON.stringify(cloud),
        change.outboxId,
        change.entity.businessId,
        change.entityType,
      ],
    );
  }
  async applyRemote(
    type: PosMutableType,
    entity: PosMutable,
  ): Promise<boolean> {
    return this.writeRemote(type, entity);
  }
  private async writeRemote(
    type: PosMutableType,
    entity: PosMutable,
  ): Promise<boolean> {
    const db = await database();
    const guard = ` AND NOT EXISTS (SELECT 1 FROM pos_sync_outbox o
      WHERE o.business_id=excluded.business_id AND o.entity_type='${type}' AND o.entity_id=excluded.id)`;
    if (type === 'category') {
      const result = await db.execute(
        `INSERT INTO product_categories
        (id,business_id,name,is_active,created_at,updated_at,sync_origin,cloud_updated_at)
        VALUES(?,?,?,?,?,?,'remote',?) ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,is_active=excluded.is_active,created_at=excluded.created_at,
        updated_at=excluded.updated_at,sync_origin='remote',cloud_updated_at=excluded.cloud_updated_at
        WHERE product_categories.business_id=excluded.business_id${guard}`,
        [
          entity.id,
          entity.businessId,
          entity.name,
          entity.isActive ? 1 : 0,
          entity.createdAt,
          entity.updatedAt,
          entity.updatedAt,
        ],
      );
      return result.rowsAffected > 0;
    }
    const product = entity as Product;
    const result = await db.execute(
      `INSERT INTO products
      (id,business_id,name,barcode,sale_price_cents,cost_price_cents,category_id,is_active,
       created_at,updated_at,sync_origin,cloud_updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'remote',?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,barcode=excluded.barcode,sale_price_cents=excluded.sale_price_cents,
      cost_price_cents=excluded.cost_price_cents,category_id=excluded.category_id,
      is_active=excluded.is_active,created_at=excluded.created_at,updated_at=excluded.updated_at,
      sync_origin='remote',cloud_updated_at=excluded.cloud_updated_at
      WHERE products.business_id=excluded.business_id${guard}`,
      [
        product.id,
        product.businessId,
        product.name,
        product.barcode,
        product.salePriceCents,
        product.costPriceCents,
        product.categoryId,
        product.isActive ? 1 : 0,
        product.createdAt,
        product.updatedAt,
        product.updatedAt,
      ],
    );
    return result.rowsAffected > 0;
  }
  async cursor(
    type: PosEntityType,
    businessId: string,
  ): Promise<PosCursor | null> {
    const db = await database();
    const rows = await db.select<{ updated_at: string; entity_id: string }[]>(
      'SELECT updated_at,entity_id FROM pos_sync_cursor WHERE business_id=? AND entity_type=?',
      [businessId, type],
    );
    return rows[0]
      ? { updatedAt: rows[0].updated_at, id: rows[0].entity_id }
      : null;
  }
  async advanceCursor(
    type: PosEntityType,
    businessId: string,
    cursor: PosCursor,
  ): Promise<void> {
    const db = await database();
    await db.execute(
      `INSERT INTO pos_sync_cursor(business_id,entity_type,updated_at,entity_id,last_success_at)
      VALUES(?,?,?,?,?) ON CONFLICT(business_id,entity_type) DO UPDATE SET
      updated_at=excluded.updated_at,entity_id=excluded.entity_id,last_success_at=excluded.last_success_at`,
      [businessId, type, cursor.updatedAt, cursor.id, new Date().toISOString()],
    );
  }
  async pendingSales(
    businessId: string,
    limit: number,
  ): Promise<PendingSale[]> {
    const db = await database();
    const rows = await db.select<{ id: string; entity_id: string }[]>(
      `SELECT id,entity_id FROM pos_sync_outbox
      WHERE business_id=? AND entity_type='sale' AND status='pending' ORDER BY created_at,id LIMIT ?`,
      [businessId, limit],
    );
    return Promise.all(
      rows.map(async (row) => {
        const bundle = await this.saleRepository.get(businessId, row.entity_id);
        if (!bundle || !bundle.items.length)
          throw new Error('Venta local pendiente sin líneas completas.');
        return { outboxId: row.id, bundle };
      }),
    );
  }
  async acknowledgeSale(change: PendingSale): Promise<void> {
    const db = await database();
    await db.execute(
      `DELETE FROM pos_sync_outbox WHERE id=? AND business_id=? AND entity_type='sale'
      AND entity_id=? AND status='pending'`,
      [change.outboxId, change.bundle.sale.businessId, change.bundle.sale.id],
    );
  }
  async applyRemoteSale(bundle: SaleBundle): Promise<void> {
    const db = await database();
    const pending = await db.select<{ id: string }[]>(
      `SELECT id FROM pos_sync_outbox WHERE
      business_id=? AND entity_type='sale' AND entity_id=?`,
      [bundle.sale.businessId, bundle.sale.id],
    );
    if (pending.length)
      throw new Error('La venta local aún está pendiente de sincronización.');
    await invoke('apply_remote_sale', {
      sale: bundle.sale,
      items: bundle.items,
    });
  }
  async summary(businessId: string): Promise<PosSyncSummary> {
    const db = await database();
    const rows = await db.select<{ status: string; count: number }[]>(
      `SELECT status,count(*) AS count
      FROM pos_sync_outbox WHERE business_id=? GROUP BY status`,
      [businessId],
    );
    const errors = await db.select<{ last_error: string | null }[]>(
      `SELECT last_error FROM pos_sync_outbox
      WHERE business_id=? AND last_error IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [businessId],
    );
    return {
      pending: rows.find((row) => row.status === 'pending')?.count ?? 0,
      conflicts: rows.find((row) => row.status === 'conflict')?.count ?? 0,
      lastError: errors[0]?.last_error ?? null,
    };
  }
  async conflicts(businessId: string): Promise<PosConflict[]> {
    const db = await database();
    const rows = await db.select<OutboxRow[]>(
      `SELECT id,entity_id,entity_type,local_revision,
      remote_snapshot,remote_updated_at,last_error FROM pos_sync_outbox WHERE business_id=? AND status='conflict'
      ORDER BY created_at LIMIT 20`,
      [businessId],
    );
    return Promise.all(
      rows.map(async (row) => {
        const entities = await db.select<Row[]>(
          `SELECT * FROM ${table(row.entity_type)}
        WHERE business_id=? AND id=?`,
          [businessId, row.entity_id],
        );
        const local = entities[0] ? decode(row.entity_type, entities[0]) : null;
        let remote: PosMutable | null = null;
        try {
          if (row.remote_snapshot)
            remote = JSON.parse(row.remote_snapshot) as PosMutable;
        } catch {
          /* An invalid saved snapshot must not hide the conflict. */
        }
        return {
          id: row.entity_id,
          type: row.entity_type,
          name: local?.name ?? row.entity_id,
          localRevision: row.local_revision,
          cloudUpdatedAt: row.remote_updated_at,
          localSummary: local
            ? describe(row.entity_type, local)
            : 'Registro local no disponible',
          cloudSummary: remote
            ? describe(row.entity_type, remote)
            : 'Versión Cloud no disponible',
        };
      }),
    );
  }
  async keepLocal(
    type: PosMutableType,
    cloud: PosMutable,
    revision: number,
  ): Promise<void> {
    const db = await database();
    const result = await db.execute(
      `UPDATE ${table(type)} SET cloud_updated_at=? WHERE business_id=?
      AND id=? AND local_revision=? AND EXISTS (SELECT 1 FROM pos_sync_outbox o
      WHERE o.business_id=? AND o.entity_type=? AND o.entity_id=? AND o.local_revision=?
      AND o.status='conflict')`,
      [
        cloud.updatedAt,
        cloud.businessId,
        cloud.id,
        revision,
        cloud.businessId,
        type,
        cloud.id,
        revision,
      ],
    );
    if (!result.rowsAffected)
      throw new Error('El producto cambió mientras se resolvía el conflicto.');
    await db.execute(
      `UPDATE pos_sync_outbox SET status='pending',last_error=NULL,
      remote_updated_at=NULL,remote_snapshot=NULL WHERE business_id=? AND entity_type=?
      AND entity_id=? AND local_revision=? AND status='conflict'`,
      [cloud.businessId, type, cloud.id, revision],
    );
  }
  async keepCloud(
    type: PosMutableType,
    cloud: PosMutable,
    revision: number,
  ): Promise<void> {
    const db = await database();
    const guard = `WHERE business_id=? AND id=? AND local_revision=? AND EXISTS (
      SELECT 1 FROM pos_sync_outbox o WHERE o.business_id=? AND o.entity_type=?
      AND o.entity_id=? AND o.status='conflict' AND o.local_revision=?)`;
    const common = [
      cloud.updatedAt,
      cloud.updatedAt,
      cloud.businessId,
      cloud.id,
      revision,
      cloud.businessId,
      type,
      cloud.id,
      revision,
    ];
    let result;
    if (type === 'category') {
      result = await db.execute(
        `UPDATE product_categories SET name=?,is_active=?,
        updated_at=?,cloud_updated_at=?,sync_origin='remote' ${guard}`,
        [cloud.name, cloud.isActive ? 1 : 0, ...common],
      );
    } else {
      const product = cloud as Product;
      result = await db.execute(
        `UPDATE products SET name=?,barcode=?,sale_price_cents=?,
        cost_price_cents=?,category_id=?,is_active=?,updated_at=?,cloud_updated_at=?,
        sync_origin='remote' ${guard}`,
        [
          product.name,
          product.barcode,
          product.salePriceCents,
          product.costPriceCents,
          product.categoryId,
          product.isActive ? 1 : 0,
          ...common,
        ],
      );
    }
    if (!result.rowsAffected)
      throw new Error(
        'El catálogo local cambió. Revisá el conflicto otra vez.',
      );
    await db.execute(
      `DELETE FROM pos_sync_outbox WHERE business_id=? AND entity_type=?
      AND entity_id=? AND local_revision=? AND status='conflict'`,
      [cloud.businessId, type, cloud.id, revision],
    );
  }
}
