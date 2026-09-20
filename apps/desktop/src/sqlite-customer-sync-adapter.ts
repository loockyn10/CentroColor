import Database from '@tauri-apps/plugin-sql';
import type {
  CustomerCursor,
  CustomerSyncLocalPort,
  PendingCustomerChange,
} from '@centrocolor/application';
import type { Customer } from '@centrocolor/domain';

type PendingRow = {
  outbox_id: string;
  outbox_revision: number;
  id: string;
  business_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  document_number: string | null;
  notes: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  cloud_updated_at: string | null;
};

function fromPendingRow(row: PendingRow): PendingCustomerChange {
  return {
    outboxId: row.outbox_id,
    localRevision: row.outbox_revision,
    cloudUpdatedAt: row.cloud_updated_at,
    customer: {
      id: row.id,
      businessId: row.business_id,
      fullName: row.full_name,
      phone: row.phone,
      email: row.email,
      documentNumber: row.document_number,
      notes: row.notes,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

const pendingSql = `SELECT o.id AS outbox_id, o.local_revision AS outbox_revision,
  c.id, c.business_id, c.full_name, c.phone, c.email, c.document_number,
  c.notes, c.is_active, c.created_at, c.updated_at, c.cloud_updated_at
  FROM sync_outbox o JOIN customers c
    ON c.id = o.entity_id AND c.business_id = o.business_id
  WHERE o.business_id = ? AND o.entity_type = 'customer'`;

async function database() {
  return Database.load('sqlite:centrocolor.db');
}

export interface CustomerSyncSummary {
  pending: number;
  conflicts: number;
  lastError: string | null;
  lastSuccessAt: string | null;
}

export interface CustomerConflict {
  id: string;
  fullName: string;
  localRevision: number;
}

export class SQLiteCustomerSyncAdapter implements CustomerSyncLocalPort {
  async pending(
    businessId: string,
    limit: number,
  ): Promise<PendingCustomerChange[]> {
    const db = await database();
    const rows = await db.select<PendingRow[]>(
      `${pendingSql} AND o.status = 'pending' ORDER BY o.created_at, o.id LIMIT ?`,
      [businessId, limit],
    );
    return rows.map(fromPendingRow);
  }

  async pendingForCustomer(
    businessId: string,
    customerId: string,
  ): Promise<PendingCustomerChange | null> {
    const db = await database();
    const rows = await db.select<PendingRow[]>(
      `${pendingSql} AND o.entity_id = ? LIMIT 1`,
      [businessId, customerId],
    );
    return rows[0] ? fromPendingRow(rows[0]) : null;
  }

  async acknowledge(
    change: PendingCustomerChange,
    cloud: Customer,
  ): Promise<void> {
    const db = await database();
    await db.execute(
      `UPDATE customers SET cloud_updated_at = ?,
       updated_at = CASE WHEN local_revision = ? THEN ? ELSE updated_at END
       WHERE business_id = ? AND id = ?`,
      [
        cloud.updatedAt,
        change.localRevision,
        cloud.updatedAt,
        change.customer.businessId,
        change.customer.id,
      ],
    );
    await db.execute(
      `DELETE FROM sync_outbox WHERE id = ? AND business_id = ?
       AND entity_id = ? AND local_revision = ? AND status = 'pending'`,
      [
        change.outboxId,
        change.customer.businessId,
        change.customer.id,
        change.localRevision,
      ],
    );
  }

  async fail(change: PendingCustomerChange, message: string): Promise<void> {
    const db = await database();
    await db.execute(
      `UPDATE sync_outbox SET attempts = attempts + 1, last_error = ?
       WHERE id = ? AND business_id = ? AND local_revision = ? AND status = 'pending'`,
      [
        message.slice(0, 500),
        change.outboxId,
        change.customer.businessId,
        change.localRevision,
      ],
    );
  }

  async conflict(
    change: PendingCustomerChange,
    cloud: Customer,
  ): Promise<void> {
    const db = await database();
    await db.execute(
      `UPDATE sync_outbox SET status = 'conflict', last_error = ?,
       remote_updated_at = ?, remote_snapshot = ?
       WHERE id = ? AND business_id = ? AND entity_id = ?`,
      [
        'El cliente también cambió en Cloud. Requiere resolución.',
        cloud.updatedAt,
        JSON.stringify(cloud),
        change.outboxId,
        change.customer.businessId,
        change.customer.id,
      ],
    );
  }

  async applyRemote(customer: Customer): Promise<boolean> {
    const db = await database();
    const result = await db.execute(
      `INSERT INTO customers
       (id, business_id, full_name, phone, email, document_number, notes,
        is_active, created_at, updated_at, sync_origin, local_revision, cloud_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'remote', 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         full_name = excluded.full_name, phone = excluded.phone,
         email = excluded.email, document_number = excluded.document_number,
         notes = excluded.notes, is_active = excluded.is_active,
         created_at = excluded.created_at, updated_at = excluded.updated_at,
         sync_origin = 'remote', cloud_updated_at = excluded.cloud_updated_at
       WHERE customers.business_id = excluded.business_id
         AND NOT EXISTS (
           SELECT 1 FROM sync_outbox o WHERE o.business_id = excluded.business_id
             AND o.entity_type = 'customer' AND o.entity_id = excluded.id
         )`,
      [
        customer.id,
        customer.businessId,
        customer.fullName,
        customer.phone,
        customer.email,
        customer.documentNumber,
        customer.notes,
        customer.isActive ? 1 : 0,
        customer.createdAt,
        customer.updatedAt,
        customer.updatedAt,
      ],
    );
    return result.rowsAffected > 0;
  }

  async cursor(businessId: string): Promise<CustomerCursor | null> {
    const db = await database();
    const rows = await db.select<{ updated_at: string; customer_id: string }[]>(
      'SELECT updated_at, customer_id FROM customer_sync_cursor WHERE business_id = ?',
      [businessId],
    );
    return rows[0]
      ? { updatedAt: rows[0].updated_at, id: rows[0].customer_id }
      : null;
  }

  async advanceCursor(
    businessId: string,
    cursor: CustomerCursor,
  ): Promise<void> {
    const db = await database();
    await db.execute(
      `INSERT INTO customer_sync_cursor (business_id, updated_at, customer_id, last_success_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(business_id) DO UPDATE SET
       updated_at = excluded.updated_at, customer_id = excluded.customer_id,
       last_success_at = excluded.last_success_at`,
      [businessId, cursor.updatedAt, cursor.id, new Date().toISOString()],
    );
  }

  async summary(businessId: string): Promise<CustomerSyncSummary> {
    const db = await database();
    const counts = await db.select<
      {
        pending: number;
        conflicts: number;
        last_error: string | null;
      }[]
    >(
      `SELECT
       sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       sum(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END) AS conflicts,
       max(last_error) AS last_error
       FROM sync_outbox WHERE business_id = ? AND entity_type = 'customer'`,
      [businessId],
    );
    const cursor = await db.select<{ last_success_at: string }[]>(
      'SELECT last_success_at FROM customer_sync_cursor WHERE business_id = ?',
      [businessId],
    );
    return {
      pending: counts[0]?.pending ?? 0,
      conflicts: counts[0]?.conflicts ?? 0,
      lastError: counts[0]?.last_error ?? null,
      lastSuccessAt: cursor[0]?.last_success_at ?? null,
    };
  }

  async conflicts(businessId: string): Promise<CustomerConflict[]> {
    const db = await database();
    const rows = await db.select<
      {
        id: string;
        full_name: string;
        local_revision: number;
      }[]
    >(
      `SELECT c.id, c.full_name, o.local_revision FROM sync_outbox o
       JOIN customers c ON c.id = o.entity_id AND c.business_id = o.business_id
       WHERE o.business_id = ? AND o.entity_type = 'customer' AND o.status = 'conflict'
       ORDER BY o.created_at, o.id LIMIT 20`,
      [businessId],
    );
    return rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      localRevision: row.local_revision,
    }));
  }

  async keepCloud(customer: Customer, localRevision: number): Promise<void> {
    const db = await database();
    const result = await db.execute(
      `UPDATE customers SET full_name = ?, phone = ?, email = ?, document_number = ?,
       notes = ?, is_active = ?, created_at = ?, updated_at = ?,
       cloud_updated_at = ?, sync_origin = 'remote'
       WHERE id = ? AND business_id = ? AND local_revision = ?
       AND EXISTS (SELECT 1 FROM sync_outbox o WHERE o.business_id = ?
         AND o.entity_type = 'customer' AND o.entity_id = ?
         AND o.status = 'conflict' AND o.local_revision = ?)`,
      [
        customer.fullName,
        customer.phone,
        customer.email,
        customer.documentNumber,
        customer.notes,
        customer.isActive ? 1 : 0,
        customer.createdAt,
        customer.updatedAt,
        customer.updatedAt,
        customer.id,
        customer.businessId,
        localRevision,
        customer.businessId,
        customer.id,
        localRevision,
      ],
    );
    if (!result.rowsAffected)
      throw new Error('El cliente local cambió. Revisá el conflicto otra vez.');
    await db.execute(
      `DELETE FROM sync_outbox WHERE business_id = ? AND entity_type = 'customer'
       AND entity_id = ? AND status = 'conflict' AND local_revision = ?`,
      [customer.businessId, customer.id, localRevision],
    );
  }

  async keepLocal(customer: Customer, localRevision: number): Promise<void> {
    const db = await database();
    const result = await db.execute(
      `UPDATE customers SET cloud_updated_at = ?
       WHERE id = ? AND business_id = ? AND local_revision = ?
       AND EXISTS (SELECT 1 FROM sync_outbox o WHERE o.business_id = ?
         AND o.entity_type = 'customer' AND o.entity_id = ?
         AND o.status = 'conflict' AND o.local_revision = ?)`,
      [
        customer.updatedAt,
        customer.id,
        customer.businessId,
        localRevision,
        customer.businessId,
        customer.id,
        localRevision,
      ],
    );
    if (!result.rowsAffected)
      throw new Error('El cliente local cambió. Revisá el conflicto otra vez.');
    await db.execute(
      `UPDATE sync_outbox SET status = 'pending', last_error = NULL,
       remote_updated_at = NULL, remote_snapshot = NULL, attempts = 0
       WHERE business_id = ? AND entity_type = 'customer' AND entity_id = ?
       AND status = 'conflict' AND local_revision = ?`,
      [customer.businessId, customer.id, localRevision],
    );
  }
}
