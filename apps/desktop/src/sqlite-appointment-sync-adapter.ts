import Database from '@tauri-apps/plugin-sql';
import type {
  AppointmentSyncCursor,
  AppointmentSyncEntity,
  AppointmentSyncLocalPort,
  AppointmentSyncType,
  PendingAppointmentChange,
} from '@centrocolor/application';
import type {
  Appointment,
  AppointmentStatus,
  AppointmentType,
} from '@centrocolor/domain';

const database = () => Database.load('sqlite:centrocolor.db');
type Row = {
  id: string;
  business_id: string;
  name?: string;
  default_duration_minutes?: number;
  is_active?: number;
  branch_id?: string;
  customer_id?: string;
  appointment_type_id?: string | null;
  title?: string;
  starts_at?: string;
  ends_at?: string;
  status?: AppointmentStatus;
  notes?: string | null;
  created_by?: string;
  created_at: string;
  updated_at: string;
  cloud_updated_at: string | null;
  local_revision: number;
  outbox_id?: string;
};
type OutboxRow = {
  id: string;
  entity_id: string;
  entity_type: AppointmentSyncType;
  local_revision: number;
  remote_snapshot: string | null;
  remote_updated_at: string | null;
};
const table = (type: AppointmentSyncType) =>
  type === 'appointment_type' ? 'appointment_types' : 'appointments';
function decode(type: AppointmentSyncType, row: Row): AppointmentSyncEntity {
  if (type === 'appointment_type')
    return {
      id: row.id,
      businessId: row.business_id,
      name: row.name!,
      defaultDurationMinutes: row.default_duration_minutes!,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id!,
    customerId: row.customer_id!,
    appointmentTypeId: row.appointment_type_id ?? null,
    title: row.title!,
    startsAt: row.starts_at!,
    endsAt: row.ends_at!,
    status: row.status!,
    notes: row.notes ?? null,
    createdBy: row.created_by!,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
const pending = (
  type: AppointmentSyncType,
  row: Row,
): PendingAppointmentChange => ({
  outboxId: row.outbox_id!,
  entityType: type,
  entity: decode(type, row),
  localRevision: row.local_revision,
  cloudUpdatedAt: row.cloud_updated_at,
});
export interface AppointmentSyncSummary {
  pending: number;
  conflicts: number;
  lastError: string | null;
}
export interface AppointmentConflict {
  id: string;
  type: AppointmentSyncType;
  label: string;
  localRevision: number;
  cloudUpdatedAt: string | null;
  localSummary: string;
  cloudSummary: string;
}
function describe(type: AppointmentSyncType, entity: AppointmentSyncEntity) {
  if (type === 'appointment_type') {
    const value = entity as AppointmentType;
    return `${value.name} · ${value.defaultDurationMinutes} min · ${value.isActive ? 'activo' : 'inactivo'}`;
  }
  const value = entity as Appointment;
  return `${value.title} · ${new Date(value.startsAt).toLocaleString('es-AR')} · ${value.status}`;
}

export class SQLiteAppointmentSyncAdapter implements AppointmentSyncLocalPort {
  async pending(type: AppointmentSyncType, businessId: string, limit: number) {
    const db = await database();
    const rows = await db.select<Row[]>(
      `SELECT t.*,o.id AS outbox_id,o.local_revision FROM appointment_sync_outbox o
       JOIN ${table(type)} t ON t.business_id=o.business_id AND t.id=o.entity_id
       WHERE o.business_id=? AND o.entity_type=? AND o.status='pending'
       ORDER BY o.created_at,o.id LIMIT ?`,
      [businessId, type, limit],
    );
    return rows.map((row) => pending(type, row));
  }
  async pendingFor(type: AppointmentSyncType, businessId: string, id: string) {
    const db = await database();
    const rows = await db.select<Row[]>(
      `SELECT t.*,o.id AS outbox_id,o.local_revision FROM appointment_sync_outbox o
       JOIN ${table(type)} t ON t.business_id=o.business_id AND t.id=o.entity_id
       WHERE o.business_id=? AND o.entity_type=? AND o.entity_id=? LIMIT 1`,
      [businessId, type, id],
    );
    return rows[0] ? pending(type, rows[0]) : null;
  }
  async acknowledge(
    change: PendingAppointmentChange,
    cloud: AppointmentSyncEntity,
  ) {
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
      `DELETE FROM appointment_sync_outbox WHERE id=? AND business_id=? AND entity_type=?
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
  async fail(change: PendingAppointmentChange, message: string) {
    const db = await database();
    await db.execute(
      `UPDATE appointment_sync_outbox SET attempts=attempts+1,last_error=?
       WHERE id=? AND status='pending'`,
      [message.slice(0, 500), change.outboxId],
    );
  }
  async conflict(
    change: PendingAppointmentChange,
    cloud: AppointmentSyncEntity,
  ) {
    const db = await database();
    await db.execute(
      `UPDATE appointment_sync_outbox SET status='conflict',last_error=?,
       remote_updated_at=?,remote_snapshot=? WHERE id=? AND business_id=? AND entity_type=?`,
      [
        'La agenda también cambió en Cloud. Requiere resolución.',
        cloud.updatedAt,
        JSON.stringify(cloud),
        change.outboxId,
        change.entity.businessId,
        change.entityType,
      ],
    );
  }
  async applyRemote(type: AppointmentSyncType, entity: AppointmentSyncEntity) {
    const db = await database();
    const guard = ` AND NOT EXISTS (SELECT 1 FROM appointment_sync_outbox o
      WHERE o.business_id=excluded.business_id AND o.entity_type='${type}' AND o.entity_id=excluded.id)`;
    if (type === 'appointment_type') {
      const value = entity as AppointmentType;
      const result = await db.execute(
        `INSERT INTO appointment_types
         (id,business_id,name,default_duration_minutes,is_active,created_at,updated_at,sync_origin,cloud_updated_at)
         VALUES(?,?,?,?,?,?,?,'remote',?) ON CONFLICT(id) DO UPDATE SET
         name=excluded.name,default_duration_minutes=excluded.default_duration_minutes,
         is_active=excluded.is_active,created_at=excluded.created_at,updated_at=excluded.updated_at,
         sync_origin='remote',cloud_updated_at=excluded.cloud_updated_at
         WHERE appointment_types.business_id=excluded.business_id${guard}`,
        [
          value.id,
          value.businessId,
          value.name,
          value.defaultDurationMinutes,
          value.isActive ? 1 : 0,
          value.createdAt,
          value.updatedAt,
          value.updatedAt,
        ],
      );
      return result.rowsAffected > 0;
    }
    const value = entity as Appointment;
    const result = await db.execute(
      `INSERT INTO appointments
       (id,business_id,branch_id,customer_id,appointment_type_id,title,starts_at,ends_at,status,notes,
        created_by,created_at,updated_at,sync_origin,cloud_updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'remote',?) ON CONFLICT(id) DO UPDATE SET
       customer_id=excluded.customer_id,appointment_type_id=excluded.appointment_type_id,
       title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status=excluded.status,
       notes=excluded.notes,created_at=excluded.created_at,updated_at=excluded.updated_at,
       sync_origin='remote',cloud_updated_at=excluded.cloud_updated_at
       WHERE appointments.business_id=excluded.business_id${guard}`,
      [
        value.id,
        value.businessId,
        value.branchId,
        value.customerId,
        value.appointmentTypeId,
        value.title,
        value.startsAt,
        value.endsAt,
        value.status,
        value.notes,
        value.createdBy,
        value.createdAt,
        value.updatedAt,
        value.updatedAt,
      ],
    );
    return result.rowsAffected > 0;
  }
  async cursor(type: AppointmentSyncType, businessId: string) {
    const db = await database();
    const rows = await db.select<{ updated_at: string; entity_id: string }[]>(
      `SELECT updated_at,entity_id FROM appointment_sync_cursor
       WHERE business_id=? AND entity_type=?`,
      [businessId, type],
    );
    return rows[0]
      ? { updatedAt: rows[0].updated_at, id: rows[0].entity_id }
      : null;
  }
  async advanceCursor(
    type: AppointmentSyncType,
    businessId: string,
    cursor: AppointmentSyncCursor,
  ) {
    const db = await database();
    await db.execute(
      `INSERT INTO appointment_sync_cursor(business_id,entity_type,updated_at,entity_id,last_success_at)
       VALUES(?,?,?,?,?) ON CONFLICT(business_id,entity_type) DO UPDATE SET
       updated_at=excluded.updated_at,entity_id=excluded.entity_id,last_success_at=excluded.last_success_at`,
      [businessId, type, cursor.updatedAt, cursor.id, new Date().toISOString()],
    );
  }
  async summary(businessId: string): Promise<AppointmentSyncSummary> {
    const db = await database();
    const rows = await db.select<{ status: string; count: number }[]>(
      `SELECT status,count(*) AS count FROM appointment_sync_outbox
       WHERE business_id=? GROUP BY status`,
      [businessId],
    );
    const errors = await db.select<{ last_error: string | null }[]>(
      `SELECT last_error FROM appointment_sync_outbox WHERE business_id=?
       AND last_error IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [businessId],
    );
    return {
      pending: rows.find((row) => row.status === 'pending')?.count ?? 0,
      conflicts: rows.find((row) => row.status === 'conflict')?.count ?? 0,
      lastError: errors[0]?.last_error ?? null,
    };
  }
  async conflicts(businessId: string): Promise<AppointmentConflict[]> {
    const db = await database();
    const rows = await db.select<OutboxRow[]>(
      `SELECT id,entity_id,entity_type,local_revision,remote_snapshot,remote_updated_at
       FROM appointment_sync_outbox WHERE business_id=? AND status='conflict'
       ORDER BY created_at LIMIT 20`,
      [businessId],
    );
    return Promise.all(
      rows.map(async (row) => {
        const localRows = await db.select<Row[]>(
          `SELECT * FROM ${table(row.entity_type)} WHERE business_id=? AND id=?`,
          [businessId, row.entity_id],
        );
        const local = localRows[0]
          ? decode(row.entity_type, localRows[0])
          : null;
        let cloud: AppointmentSyncEntity | null = null;
        try {
          if (row.remote_snapshot)
            cloud = JSON.parse(row.remote_snapshot) as AppointmentSyncEntity;
        } catch {
          /* Keep the conflict visible if a snapshot is malformed. */
        }
        return {
          id: row.entity_id,
          type: row.entity_type,
          label:
            row.entity_type === 'appointment_type'
              ? ((local as AppointmentType | null)?.name ?? row.entity_id)
              : ((local as Appointment | null)?.title ?? row.entity_id),
          localRevision: row.local_revision,
          cloudUpdatedAt: row.remote_updated_at,
          localSummary: local
            ? describe(row.entity_type, local)
            : 'No disponible',
          cloudSummary: cloud
            ? describe(row.entity_type, cloud)
            : 'No disponible',
        };
      }),
    );
  }
  async keepLocal(
    type: AppointmentSyncType,
    cloud: AppointmentSyncEntity,
    revision: number,
  ) {
    const db = await database();
    const result = await db.execute(
      `UPDATE ${table(type)} SET cloud_updated_at=? WHERE business_id=? AND id=?
       AND local_revision=? AND EXISTS (SELECT 1 FROM appointment_sync_outbox o
       WHERE o.business_id=? AND o.entity_type=? AND o.entity_id=?
       AND o.local_revision=? AND o.status='conflict')`,
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
      throw new Error('La agenda local volvió a cambiar.');
    await db.execute(
      `UPDATE appointment_sync_outbox SET status='pending',last_error=NULL,
       remote_updated_at=NULL,remote_snapshot=NULL WHERE business_id=? AND entity_type=?
       AND entity_id=? AND local_revision=? AND status='conflict'`,
      [cloud.businessId, type, cloud.id, revision],
    );
  }
  async keepCloud(
    type: AppointmentSyncType,
    cloud: AppointmentSyncEntity,
    revision: number,
  ) {
    const db = await database();
    const guard = `WHERE business_id=? AND id=? AND local_revision=? AND EXISTS (
      SELECT 1 FROM appointment_sync_outbox o WHERE o.business_id=? AND o.entity_type=?
      AND o.entity_id=? AND o.local_revision=? AND o.status='conflict')`;
    let result;
    if (type === 'appointment_type') {
      const value = cloud as AppointmentType;
      result = await db.execute(
        `UPDATE appointment_types SET name=?,default_duration_minutes=?,is_active=?,
         updated_at=?,cloud_updated_at=?,sync_origin='remote' ${guard}`,
        [
          value.name,
          value.defaultDurationMinutes,
          value.isActive ? 1 : 0,
          value.updatedAt,
          value.updatedAt,
          value.businessId,
          value.id,
          revision,
          value.businessId,
          type,
          value.id,
          revision,
        ],
      );
    } else {
      const value = cloud as Appointment;
      result = await db.execute(
        `UPDATE appointments SET customer_id=?,appointment_type_id=?,title=?,starts_at=?,ends_at=?,
         status=?,notes=?,updated_at=?,cloud_updated_at=?,sync_origin='remote' ${guard}`,
        [
          value.customerId,
          value.appointmentTypeId,
          value.title,
          value.startsAt,
          value.endsAt,
          value.status,
          value.notes,
          value.updatedAt,
          value.updatedAt,
          value.businessId,
          value.id,
          revision,
          value.businessId,
          type,
          value.id,
          revision,
        ],
      );
    }
    if (!result.rowsAffected)
      throw new Error('La agenda local volvió a cambiar.');
    await db.execute(
      `DELETE FROM appointment_sync_outbox WHERE business_id=? AND entity_type=?
       AND entity_id=? AND local_revision=? AND status='conflict'`,
      [cloud.businessId, type, cloud.id, revision],
    );
  }
}
