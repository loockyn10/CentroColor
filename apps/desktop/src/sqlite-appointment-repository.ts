import Database from '@tauri-apps/plugin-sql';
import type {
  AppointmentListQuery,
  AppointmentRepository,
  AppointmentSummary,
} from '@centrocolor/application';
import type {
  Appointment,
  AppointmentDetails,
  AppointmentStatus,
  AppointmentType,
  AppointmentTypeDetails,
} from '@centrocolor/domain';

const database = () => Database.load('sqlite:centrocolor.db');
type TypeRow = {
  id: string;
  business_id: string;
  name: string;
  default_duration_minutes: number;
  is_active: number;
  created_at: string;
  updated_at: string;
};
type AppointmentRow = {
  id: string;
  business_id: string;
  branch_id: string;
  customer_id: string;
  appointment_type_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  customer_name?: string;
  appointment_type_name?: string | null;
};
const fromType = (row: TypeRow): AppointmentType => ({
  id: row.id,
  businessId: row.business_id,
  name: row.name,
  defaultDurationMinutes: row.default_duration_minutes,
  isActive: row.is_active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const fromAppointment = (row: AppointmentRow): Appointment => ({
  id: row.id,
  businessId: row.business_id,
  branchId: row.branch_id,
  customerId: row.customer_id,
  appointmentTypeId: row.appointment_type_id,
  title: row.title,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  status: row.status,
  notes: row.notes,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const summary = (row: AppointmentRow): AppointmentSummary => ({
  ...fromAppointment(row),
  customerName: row.customer_name ?? 'Cliente',
  appointmentTypeName: row.appointment_type_name ?? null,
});

export class SQLiteAppointmentRepository implements AppointmentRepository {
  async listTypes(businessId: string, includeInactive = false) {
    const db = await database();
    const rows = await db.select<TypeRow[]>(
      `SELECT * FROM appointment_types WHERE business_id=? ${includeInactive ? '' : 'AND is_active=1'}
       ORDER BY is_active DESC,name COLLATE NOCASE,id`,
      [businessId],
    );
    return rows.map(fromType);
  }
  async getType(businessId: string, id: string) {
    const db = await database();
    const rows = await db.select<TypeRow[]>(
      'SELECT * FROM appointment_types WHERE business_id=? AND id=?',
      [businessId, id],
    );
    return rows[0] ? fromType(rows[0]) : null;
  }
  private async assertAdmin(businessId: string) {
    const db = await database();
    const rows = await db.select<{ ok: number }[]>(
      `SELECT count(*) AS ok FROM authorized_context
       WHERE slot=1 AND business_id=? AND role IN ('owner','admin')`,
      [businessId],
    );
    if (rows[0]?.ok !== 1)
      throw new Error('Solo owner/admin puede gestionar tipos de turno.');
  }
  async createType(type: AppointmentType) {
    await this.assertAdmin(type.businessId);
    const db = await database();
    await db.execute(
      `INSERT INTO appointment_types
       (id,business_id,name,default_duration_minutes,is_active,created_at,updated_at,sync_origin,local_revision)
       VALUES(?,?,?,?,?,?,?,'local',1)`,
      [
        type.id,
        type.businessId,
        type.name,
        type.defaultDurationMinutes,
        type.isActive ? 1 : 0,
        type.createdAt,
        type.updatedAt,
      ],
    );
    return type;
  }
  async updateType(
    businessId: string,
    id: string,
    details: AppointmentTypeDetails,
  ) {
    await this.assertAdmin(businessId);
    const db = await database();
    const result = await db.execute(
      `UPDATE appointment_types SET name=?,default_duration_minutes=?,updated_at=?,
       sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [
        details.name,
        details.defaultDurationMinutes,
        new Date().toISOString(),
        businessId,
        id,
      ],
    );
    if (!result.rowsAffected)
      throw new Error('No se encontró el tipo de turno.');
    return (await this.getType(businessId, id))!;
  }
  async setTypeActive(businessId: string, id: string, active: boolean) {
    await this.assertAdmin(businessId);
    const db = await database();
    const result = await db.execute(
      `UPDATE appointment_types SET is_active=?,updated_at=?,sync_origin='local',
       local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [active ? 1 : 0, new Date().toISOString(), businessId, id],
    );
    if (!result.rowsAffected)
      throw new Error('No se encontró el tipo de turno.');
    return (await this.getType(businessId, id))!;
  }
  async list(query: AppointmentListQuery) {
    const db = await database();
    const term = `%${(query.query ?? '').replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await db.select<AppointmentRow[]>(
      `SELECT a.*,c.full_name AS customer_name,t.name AS appointment_type_name
       FROM appointments a JOIN customers c ON c.business_id=a.business_id AND c.id=a.customer_id
       LEFT JOIN appointment_types t ON t.business_id=a.business_id AND t.id=a.appointment_type_id
       WHERE a.business_id=? AND a.branch_id=? AND a.starts_at>=? AND a.starts_at<?
       AND (? IS NULL OR a.status=?)
       AND (?='' OR a.title LIKE ? ESCAPE '\\' OR c.full_name LIKE ? ESCAPE '\\')
       ORDER BY a.starts_at,a.id LIMIT ?`,
      [
        query.businessId,
        query.branchId,
        query.from,
        query.to,
        query.status ?? null,
        query.status ?? null,
        query.query?.trim() ?? '',
        term,
        term,
        query.limit,
      ],
    );
    return rows.map(summary);
  }
  async get(businessId: string, id: string) {
    const db = await database();
    const rows = await db.select<AppointmentRow[]>(
      'SELECT * FROM appointments WHERE business_id=? AND id=?',
      [businessId, id],
    );
    return rows[0] ? fromAppointment(rows[0]) : null;
  }
  async create(appointment: Appointment) {
    const db = await database();
    const allowed = await db.select<{ ok: number }[]>(
      `SELECT count(*) AS ok FROM authorized_context WHERE slot=1 AND business_id=?
       AND branch_id=? AND user_id=?`,
      [appointment.businessId, appointment.branchId, appointment.createdBy],
    );
    if (allowed[0]?.ok !== 1)
      throw new Error('El turno no corresponde al contexto autorizado.');
    await db.execute(
      `INSERT INTO appointments
       (id,business_id,branch_id,customer_id,appointment_type_id,title,starts_at,ends_at,status,
        notes,created_by,created_at,updated_at,sync_origin,local_revision)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'local',1)`,
      [
        appointment.id,
        appointment.businessId,
        appointment.branchId,
        appointment.customerId,
        appointment.appointmentTypeId,
        appointment.title,
        appointment.startsAt,
        appointment.endsAt,
        appointment.status,
        appointment.notes,
        appointment.createdBy,
        appointment.createdAt,
        appointment.updatedAt,
      ],
    );
    return appointment;
  }
  async update(businessId: string, id: string, details: AppointmentDetails) {
    const db = await database();
    const result = await db.execute(
      `UPDATE appointments SET customer_id=?,appointment_type_id=?,title=?,starts_at=?,ends_at=?,
       notes=?,updated_at=?,sync_origin='local',local_revision=local_revision+1
       WHERE business_id=? AND id=?`,
      [
        details.customerId,
        details.appointmentTypeId,
        details.title,
        details.startsAt,
        details.endsAt,
        details.notes,
        new Date().toISOString(),
        businessId,
        id,
      ],
    );
    if (!result.rowsAffected) throw new Error('No se encontró el turno.');
    return (await this.get(businessId, id))!;
  }
  async setStatus(businessId: string, id: string, status: AppointmentStatus) {
    const db = await database();
    if (status === 'cancelled') await this.assertAdmin(businessId);
    const result = await db.execute(
      `UPDATE appointments SET status=?,updated_at=?,sync_origin='local',
       local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [status, new Date().toISOString(), businessId, id],
    );
    if (!result.rowsAffected) throw new Error('No se encontró el turno.');
    return (await this.get(businessId, id))!;
  }
  async overlaps(
    businessId: string,
    branchId: string,
    startsAt: string,
    endsAt: string,
    excludeId?: string,
  ) {
    const db = await database();
    const rows = await db.select<AppointmentRow[]>(
      `SELECT a.*,c.full_name AS customer_name,t.name AS appointment_type_name
       FROM appointments a JOIN customers c ON c.business_id=a.business_id AND c.id=a.customer_id
       LEFT JOIN appointment_types t ON t.business_id=a.business_id AND t.id=a.appointment_type_id
       WHERE a.business_id=? AND a.branch_id=? AND a.status='scheduled'
       AND a.starts_at<? AND a.ends_at>? AND (? IS NULL OR a.id<>?)
       ORDER BY a.starts_at LIMIT 20`,
      [
        businessId,
        branchId,
        endsAt,
        startsAt,
        excludeId ?? null,
        excludeId ?? null,
      ],
    );
    return rows.map(summary);
  }
}
