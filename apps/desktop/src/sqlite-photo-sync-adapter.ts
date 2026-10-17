/* eslint-disable @typescript-eslint/no-explicit-any -- SQLite sync mapping is isolated here. */
import Database from '@tauri-apps/plugin-sql';
import type {
  PendingPhotoChange,
  PhotoSyncCursor,
  PhotoSyncEntity,
  PhotoSyncLocalPort,
  PhotoSyncType,
} from '@centrocolor/application';
const db = () => Database.load('sqlite:centrocolor.db');
const table = (t: PhotoSyncType) =>
  (
    ({
      photo_service: 'photo_services',
      photo_job: 'photo_jobs',
      photo_job_item: 'photo_job_items',
    }) as const
  )[t];
export const decodeLocalPhoto = (t: PhotoSyncType, r: any): any => {
  const base = {
    id: r.id,
    businessId: r.business_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (t === 'photo_service')
    return {
      ...base,
      code: r.code,
      name: r.name,
      serviceType: r.service_type,
      widthMm: r.width_mm,
      heightMm: r.height_mm,
      defaultUnitPriceCents: r.default_unit_price_cents,
      workflowRoute: r.workflow_route,
      requiresCustomerFiles: r.requires_customer_files === 1,
      isActive: r.is_active === 1,
    };
  if (t === 'photo_job')
    return {
      ...base,
      branchId: r.branch_id,
      customerId: r.customer_id,
      status: r.status,
      priority: r.priority,
      promisedAt: r.promised_at,
      notes: r.notes,
      sourceAppointmentId: r.source_appointment_id,
      sourceEventId: r.source_event_id,
      fileIntakeStatus: r.file_intake_status,
      driveFolderId: r.drive_folder_id,
      driveEditedFolderId: r.drive_edited_folder_id,
      createdBy: r.created_by,
    };
  return {
    ...base,
    photoJobId: r.photo_job_id,
    photoServiceId: r.photo_service_id,
    serviceNameSnapshot: r.service_name_snapshot,
    quantity: r.quantity,
    unitPriceCents: r.unit_price_cents,
    totalCents: r.total_cents,
    notes: r.notes,
    widthMm: r.width_mm,
    heightMm: r.height_mm,
    isActive: r.is_active === 1,
  };
};
export class SQLitePhotoSyncAdapter implements PhotoSyncLocalPort {
  async pending(t: PhotoSyncType, b: string, limit: number) {
    const rows = await (
      await db()
    ).select<any[]>(
      `SELECT x.*,o.id outbox_id,o.local_revision outbox_revision FROM photo_sync_outbox o JOIN ${table(t)} x ON x.business_id=o.business_id AND x.id=o.entity_id WHERE o.business_id=? AND o.entity_type=? AND o.status='pending' ORDER BY o.created_at LIMIT ?`,
      [b, t, limit],
    );
    return rows.map(
      (r) =>
        ({
          outboxId: r.outbox_id,
          entityType: t,
          entity: decodeLocalPhoto(t, r),
          localRevision: r.outbox_revision,
          cloudUpdatedAt: r.cloud_updated_at,
        }) satisfies PendingPhotoChange,
    );
  }
  async pendingFor(t: PhotoSyncType, b: string, id: string) {
    const rows = await (
      await db()
    ).select<any[]>(
      `SELECT x.*,o.id outbox_id,o.local_revision outbox_revision FROM photo_sync_outbox o JOIN ${table(t)} x ON x.business_id=o.business_id AND x.id=o.entity_id WHERE o.business_id=? AND o.entity_type=? AND o.entity_id=? AND o.status IN('pending','conflict') LIMIT 1`,
      [b, t, id],
    );
    const row = rows[0];
    return row
      ? ({
          outboxId: row.outbox_id,
          entityType: t,
          entity: decodeLocalPhoto(t, row),
          localRevision: row.outbox_revision,
          cloudUpdatedAt: row.cloud_updated_at,
        } satisfies PendingPhotoChange)
      : null;
  }
  async acknowledge(change: PendingPhotoChange, cloud: PhotoSyncEntity) {
    const d = await db();
    await d.execute(
      `UPDATE ${table(change.entityType)} SET cloud_updated_at=? WHERE business_id=? AND id=?`,
      [cloud.updatedAt, cloud.businessId, cloud.id],
    );
    await d.execute(
      `DELETE FROM photo_sync_outbox WHERE id=? AND local_revision=?`,
      [change.outboxId, change.localRevision],
    );
  }
  async fail(change: PendingPhotoChange, message: string) {
    await (
      await db()
    ).execute(
      `UPDATE photo_sync_outbox SET attempts=attempts+1,last_error=? WHERE id=?`,
      [message.slice(0, 500), change.outboxId],
    );
  }
  async conflict(change: PendingPhotoChange, cloud: PhotoSyncEntity) {
    await (
      await db()
    ).execute(
      `UPDATE photo_sync_outbox SET status='conflict',remote_updated_at=?,remote_snapshot=?,last_error=? WHERE id=?`,
      [
        cloud.updatedAt,
        JSON.stringify(cloud),
        'El registro cambió también en Web; se conservó la versión Desktop.',
        change.outboxId,
      ],
    );
  }
  async applyRemote(t: PhotoSyncType, e: PhotoSyncEntity) {
    const d = await db(),
      x: any = e;
    if (t === 'photo_service')
      await d.execute(
        `INSERT INTO photo_services(id,business_id,code,name,service_type,width_mm,height_mm,default_unit_price_cents,workflow_route,requires_customer_files,is_active,created_at,updated_at,sync_origin,local_revision,cloud_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'remote',0,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,service_type=excluded.service_type,width_mm=excluded.width_mm,height_mm=excluded.height_mm,default_unit_price_cents=excluded.default_unit_price_cents,workflow_route=excluded.workflow_route,requires_customer_files=excluded.requires_customer_files,is_active=excluded.is_active,updated_at=excluded.updated_at,sync_origin='remote',cloud_updated_at=excluded.cloud_updated_at`,
        [
          x.id,
          x.businessId,
          x.code,
          x.name,
          x.serviceType,
          x.widthMm,
          x.heightMm,
          x.defaultUnitPriceCents,
          x.workflowRoute,
          x.requiresCustomerFiles ? 1 : 0,
          x.isActive ? 1 : 0,
          x.createdAt,
          x.updatedAt,
          x.updatedAt,
        ],
      );
    else if (t === 'photo_job')
      await d.execute(
        `INSERT INTO photo_jobs(id,business_id,branch_id,customer_id,status,priority,promised_at,notes,source_appointment_id,source_event_id,file_intake_status,drive_folder_id,drive_edited_folder_id,created_by,created_at,updated_at,sync_origin,local_revision,cloud_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'remote',0,?) ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,status=excluded.status,priority=excluded.priority,promised_at=excluded.promised_at,notes=excluded.notes,source_appointment_id=excluded.source_appointment_id,source_event_id=excluded.source_event_id,file_intake_status=excluded.file_intake_status,drive_folder_id=excluded.drive_folder_id,drive_edited_folder_id=excluded.drive_edited_folder_id,updated_at=excluded.updated_at,sync_origin='remote',cloud_updated_at=excluded.cloud_updated_at`,
        [
          x.id,
          x.businessId,
          x.branchId,
          x.customerId,
          x.status,
          x.priority,
          x.promisedAt,
          x.notes,
          x.sourceAppointmentId,
          x.sourceEventId,
          x.fileIntakeStatus,
          x.driveFolderId,
          x.driveEditedFolderId,
          x.createdBy,
          x.createdAt,
          x.updatedAt,
          x.updatedAt,
        ],
      );
    else
      await d.execute(
        `INSERT INTO photo_job_items(id,business_id,photo_job_id,photo_service_id,service_name_snapshot,quantity,unit_price_cents,total_cents,notes,width_mm,height_mm,is_active,created_at,updated_at,sync_origin,local_revision,cloud_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'remote',0,?) ON CONFLICT(id) DO UPDATE SET photo_service_id=excluded.photo_service_id,service_name_snapshot=excluded.service_name_snapshot,quantity=excluded.quantity,unit_price_cents=excluded.unit_price_cents,total_cents=excluded.total_cents,notes=excluded.notes,width_mm=excluded.width_mm,height_mm=excluded.height_mm,is_active=excluded.is_active,updated_at=excluded.updated_at,sync_origin='remote',cloud_updated_at=excluded.cloud_updated_at`,
        [
          x.id,
          x.businessId,
          x.photoJobId,
          x.photoServiceId,
          x.serviceNameSnapshot,
          x.quantity,
          x.unitPriceCents,
          x.totalCents,
          x.notes,
          x.widthMm,
          x.heightMm,
          x.isActive ? 1 : 0,
          x.createdAt,
          x.updatedAt,
          x.updatedAt,
        ],
      );
    return true;
  }
  async cursor(t: PhotoSyncType, b: string) {
    const r = await (
      await db()
    ).select<any[]>(
      `SELECT updated_at,entity_id FROM photo_sync_cursor WHERE business_id=? AND entity_type=?`,
      [b, t],
    );
    return r[0] ? { updatedAt: r[0].updated_at, id: r[0].entity_id } : null;
  }
  async advanceCursor(t: PhotoSyncType, b: string, c: PhotoSyncCursor) {
    await (
      await db()
    ).execute(
      `INSERT INTO photo_sync_cursor VALUES(?,?,?,?,?) ON CONFLICT(business_id,entity_type) DO UPDATE SET updated_at=excluded.updated_at,entity_id=excluded.entity_id,last_success_at=excluded.last_success_at`,
      [b, t, c.updatedAt, c.id, new Date().toISOString()],
    );
  }
  async summary(b: string) {
    const r = await (
      await db()
    ).select<any[]>(
      `SELECT status,count(*) count FROM photo_sync_outbox WHERE business_id=? GROUP BY status`,
      [b],
    );
    return {
      pending: r.find((x) => x.status === 'pending')?.count ?? 0,
      conflicts: r.find((x) => x.status === 'conflict')?.count ?? 0,
    };
  }
}
