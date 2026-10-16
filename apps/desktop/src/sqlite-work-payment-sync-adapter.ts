/* eslint-disable @typescript-eslint/no-explicit-any -- SQLite sync mapping stays at this boundary. */
import Database from '@tauri-apps/plugin-sql';
import type {
  PendingWorkPayment,
  WorkPaymentCursor,
  WorkPaymentSyncLocalPort,
} from '@centrocolor/application';
import type { WorkPayment } from '@centrocolor/domain';
import { localWorkPayment } from './sqlite-work-payment-repository';
const db = () => Database.load('sqlite:centrocolor.db');
export class SQLiteWorkPaymentSyncAdapter implements WorkPaymentSyncLocalPort {
  async pending(b: string, limit: number) {
    const rows = await (
      await db()
    ).select<any[]>(
      `SELECT p.*,o.id outbox_id,o.local_revision outbox_revision FROM work_payment_sync_outbox o JOIN work_payments p ON p.business_id=o.business_id AND p.id=o.payment_id WHERE o.business_id=? AND o.status='pending' ORDER BY o.created_at LIMIT ?`,
      [b, limit],
    );
    return rows.map((r) => ({
      outboxId: r.outbox_id,
      payment: localWorkPayment(r),
      localRevision: r.outbox_revision,
    }));
  }
  async pendingFor(b: string, id: string) {
    const rows = await (
      await db()
    ).select<any[]>(
      `SELECT p.*,o.id outbox_id,o.local_revision outbox_revision FROM work_payment_sync_outbox o JOIN work_payments p ON p.business_id=o.business_id AND p.id=o.payment_id WHERE o.business_id=? AND o.payment_id=? LIMIT 1`,
      [b, id],
    );
    return rows[0]
      ? {
          outboxId: rows[0].outbox_id,
          payment: localWorkPayment(rows[0]),
          localRevision: rows[0].outbox_revision,
        }
      : null;
  }
  async acknowledge(change: PendingWorkPayment, cloud: WorkPayment) {
    const d = await db();
    await d.execute(
      `UPDATE work_payments SET status=?,voided_at=?,voided_by=?,void_reason=?,updated_at=?,cloud_updated_at=?,sync_origin='remote' WHERE business_id=? AND id=?`,
      [
        cloud.status,
        cloud.voidedAt,
        cloud.voidedBy,
        cloud.voidReason,
        cloud.updatedAt,
        cloud.updatedAt,
        cloud.businessId,
        cloud.id,
      ],
    );
    await d.execute(
      `DELETE FROM work_payment_sync_outbox WHERE id=? AND local_revision=?`,
      [change.outboxId, change.localRevision],
    );
  }
  async fail(change: PendingWorkPayment, message: string, conflict = false) {
    await (
      await db()
    ).execute(
      `UPDATE work_payment_sync_outbox SET attempts=attempts+1,last_error=?,status=? WHERE id=?`,
      [
        message.slice(0, 500),
        conflict ? 'conflict' : 'pending',
        change.outboxId,
      ],
    );
  }
  async applyRemote(x: WorkPayment) {
    await (
      await db()
    ).execute(
      `INSERT INTO work_payments(id,business_id,branch_id,customer_id,source_type,event_id,frame_job_id,photo_job_id,payment_kind,payment_method,amount_cents,occurred_at,notes,status,created_by,voided_at,voided_by,void_reason,created_at,updated_at,sync_origin,local_revision,cloud_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'remote',0,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,voided_at=excluded.voided_at,voided_by=excluded.voided_by,void_reason=excluded.void_reason,updated_at=excluded.updated_at,cloud_updated_at=excluded.cloud_updated_at,sync_origin='remote'`,
      [
        x.id,
        x.businessId,
        x.branchId,
        x.customerId,
        x.sourceType,
        x.eventId,
        x.frameJobId,
        x.photoJobId,
        x.paymentKind,
        x.paymentMethod,
        x.amountCents,
        x.occurredAt,
        x.notes,
        x.status,
        x.createdBy,
        x.voidedAt,
        x.voidedBy,
        x.voidReason,
        x.createdAt,
        x.updatedAt,
        x.updatedAt,
      ],
    );
    return true;
  }
  async cursor(b: string) {
    const r = await (
      await db()
    ).select<any[]>(
      `SELECT updated_at,payment_id FROM work_payment_sync_cursor WHERE business_id=?`,
      [b],
    );
    return r[0] ? { updatedAt: r[0].updated_at, id: r[0].payment_id } : null;
  }
  async advanceCursor(b: string, c: WorkPaymentCursor) {
    await (
      await db()
    ).execute(
      `INSERT INTO work_payment_sync_cursor VALUES(?,?,?,?) ON CONFLICT(business_id) DO UPDATE SET updated_at=excluded.updated_at,payment_id=excluded.payment_id,last_success_at=excluded.last_success_at`,
      [b, c.updatedAt, c.id, new Date().toISOString()],
    );
  }
  async summary(b: string) {
    const r = await (
      await db()
    ).select<any[]>(
      `SELECT status,count(*) count FROM work_payment_sync_outbox WHERE business_id=? GROUP BY status`,
      [b],
    );
    return {
      pending: r.find((x) => x.status === 'pending')?.count ?? 0,
      conflicts: r.find((x) => x.status === 'conflict')?.count ?? 0,
    };
  }
}
