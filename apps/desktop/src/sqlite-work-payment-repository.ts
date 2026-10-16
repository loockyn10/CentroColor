/* eslint-disable @typescript-eslint/no-explicit-any -- SQLite row mapping stays at this boundary. */
import Database from '@tauri-apps/plugin-sql';
import type { WorkPaymentRepository } from '@centrocolor/application';
import {
  requireVoidReason,
  workAccountTotals,
  type CustomerWorkAccount,
  type WorkAccount,
  type WorkPayment,
  type WorkPaymentSourceType,
} from '@centrocolor/domain';

const db = () => Database.load('sqlite:centrocolor.db');
export const localWorkPayment = (x: any): WorkPayment => ({
  id: x.id,
  businessId: x.business_id,
  branchId: x.branch_id,
  customerId: x.customer_id,
  sourceType: x.source_type,
  eventId: x.event_id,
  frameJobId: x.frame_job_id,
  photoJobId: x.photo_job_id,
  paymentKind: x.payment_kind,
  paymentMethod: x.payment_method,
  amountCents: x.amount_cents,
  occurredAt: x.occurred_at,
  notes: x.notes,
  status: x.status,
  createdBy: x.created_by,
  voidedAt: x.voided_at,
  voidedBy: x.voided_by,
  voidReason: x.void_reason,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});

const sourceColumn = (type: WorkPaymentSourceType) =>
  type === 'event'
    ? 'event_id'
    : type === 'frame_job'
      ? 'frame_job_id'
      : 'photo_job_id';

export class SQLiteWorkPaymentRepository implements WorkPaymentRepository {
  async getAccount(
    businessId: string,
    sourceType: WorkPaymentSourceType,
    sourceId: string,
  ) {
    const d = await db();
    const sourceSql =
      sourceType === 'event'
        ? `SELECT e.customer_id,e.status source_status,e.title description,
          COALESCE((SELECT sum(total_cents) FROM event_service_items i WHERE i.business_id=e.business_id AND i.event_id=e.id AND i.is_active=1),0)+
          COALESCE((SELECT sum(price_cents) FROM resource_reservations r WHERE r.business_id=e.business_id AND r.event_id=e.id AND r.is_active=1),0) total_cents
         FROM events e WHERE e.business_id=? AND e.id=?`
        : sourceType === 'frame_job'
          ? `SELECT j.customer_id,j.status source_status,'Marquetería '||(q.width_mm/10.0)||'×'||(q.height_mm/10.0)||' cm' description,q.total_cents
           FROM frame_jobs j JOIN frame_quotes q ON q.business_id=j.business_id AND q.id=j.quote_id WHERE j.business_id=? AND j.id=?`
          : `SELECT j.customer_id,j.status source_status,
            COALESCE((SELECT group_concat(service_name_snapshot,', ') FROM photo_job_items i WHERE i.business_id=j.business_id AND i.photo_job_id=j.id AND i.is_active=1),'Trabajo fotográfico') description,
            COALESCE((SELECT sum(total_cents) FROM photo_job_items i WHERE i.business_id=j.business_id AND i.photo_job_id=j.id AND i.is_active=1),0) total_cents
           FROM photo_jobs j WHERE j.business_id=? AND j.id=?`;
    const source = (
      await d.select<any[]>(sourceSql, [businessId, sourceId])
    )[0];
    if (!source) return null;
    const rows = await d.select<any[]>(
      `SELECT p.*,o.status outbox_status FROM work_payments p LEFT JOIN work_payment_sync_outbox o ON o.business_id=p.business_id AND o.payment_id=p.id WHERE p.business_id=? AND p.${sourceColumn(sourceType)}=? ORDER BY p.occurred_at DESC,p.created_at DESC`,
      [businessId, sourceId],
    );
    const payments = rows.map(localWorkPayment);
    const counted = rows
      .filter((x) => x.outbox_status !== 'conflict')
      .map(localWorkPayment);
    return {
      sourceType,
      sourceId,
      customerId: source.customer_id,
      description: source.description,
      sourceStatus: source.source_status,
      payments,
      ...workAccountTotals(source.total_cents, counted),
      conflictPaymentIds: rows
        .filter((x) => x.outbox_status === 'conflict')
        .map((x) => x.id),
    } satisfies WorkAccount;
  }

  private async sourceIds(b: string, where: string, params: unknown[]) {
    const d = await db();
    const [events, frames, photos] = await Promise.all([
      d.select<any[]>(
        `SELECT id FROM events WHERE business_id=? AND ${where}`,
        [b, ...params],
      ),
      d.select<any[]>(
        `SELECT id FROM frame_jobs WHERE business_id=? AND ${where}`,
        [b, ...params],
      ),
      d.select<any[]>(
        `SELECT id FROM photo_jobs WHERE business_id=? AND ${where}`,
        [b, ...params],
      ),
    ]);
    return [
      ...events.map((x) => ['event', x.id] as const),
      ...frames.map((x) => ['frame_job', x.id] as const),
      ...photos.map((x) => ['photo_job', x.id] as const),
    ];
  }

  async getCustomerAccount(
    businessId: string,
    customerId: string,
  ): Promise<CustomerWorkAccount> {
    const ids = await this.sourceIds(businessId, 'customer_id=?', [customerId]);
    const all = (
      await Promise.all(
        ids.map(([t, id]) => this.getAccount(businessId, t, id)),
      )
    ).filter(Boolean) as WorkAccount[];
    const sources = all.filter(
      (x) => x.balanceCents > 0 || x.sourceStatus === 'cancelled',
    );
    const recentPayments = all
      .flatMap((x) => x.payments)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, 20);
    return {
      customerId,
      sources,
      recentPayments,
      balanceCents: sources
        .filter((x) => x.sourceStatus !== 'cancelled')
        .reduce((sum, x) => sum + Math.max(0, x.balanceCents), 0),
    };
  }

  async listOutstanding(businessId: string, branchId: string) {
    const ids = await this.sourceIds(
      businessId,
      "branch_id=? AND status<>'cancelled'",
      [branchId],
    );
    const rows = (
      await Promise.all(
        ids.map(([t, id]) => this.getAccount(businessId, t, id)),
      )
    ).filter(Boolean) as WorkAccount[];
    return rows.filter((x) => x.balanceCents > 0);
  }

  async post(x: WorkPayment) {
    await (
      await db()
    ).execute(
      `INSERT INTO work_payments(id,business_id,branch_id,customer_id,source_type,event_id,frame_job_id,photo_job_id,payment_kind,payment_method,amount_cents,occurred_at,notes,status,created_by,voided_at,voided_by,void_reason,created_at,updated_at,sync_origin,local_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'posted',?,NULL,NULL,NULL,?,?,'local',1)`,
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
        x.createdBy,
        x.createdAt,
        x.updatedAt,
      ],
    );
    return x;
  }

  async void(
    b: string,
    id: string,
    actor: string,
    reason: string,
    occurredAt = new Date().toISOString(),
  ) {
    const d = await db();
    await d.execute(
      `UPDATE work_payments SET status='voided',voided_at=?,voided_by=?,void_reason=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=? AND status='posted'`,
      [occurredAt, actor, requireVoidReason(reason), occurredAt, b, id],
    );
    const row = (
      await d.select<any[]>(
        'SELECT * FROM work_payments WHERE business_id=? AND id=?',
        [b, id],
      )
    )[0];
    if (!row) throw new Error('No se encontró el pago.');
    return localWorkPayment(row);
  }
}
