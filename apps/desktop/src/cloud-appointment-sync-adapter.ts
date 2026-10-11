import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AppointmentSyncCloudPort,
  AppointmentSyncCursor,
  AppointmentSyncEntity,
  AppointmentSyncType,
  PendingAppointmentChange,
} from '@centrocolor/application';
import type {
  Appointment,
  AppointmentStatus,
  AppointmentType,
} from '@centrocolor/domain';

type TypeRow = {
  id: string;
  business_id: string;
  name: string;
  default_duration_minutes: number;
  is_active: boolean;
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
};
const decodeType = (row: TypeRow): AppointmentType => ({
  id: row.id,
  businessId: row.business_id,
  name: row.name,
  defaultDurationMinutes: row.default_duration_minutes,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const decodeAppointment = (row: AppointmentRow): Appointment => ({
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
const table = (type: AppointmentSyncType) =>
  type === 'appointment_type' ? 'appointment_types' : 'appointments';
const decode = (type: AppointmentSyncType, row: unknown) =>
  type === 'appointment_type'
    ? decodeType(row as TypeRow)
    : decodeAppointment(row as AppointmentRow);
function details(type: AppointmentSyncType, entity: AppointmentSyncEntity) {
  if (type === 'appointment_type') {
    const value = entity as AppointmentType;
    return {
      name: value.name,
      default_duration_minutes: value.defaultDurationMinutes,
      is_active: value.isActive,
    };
  }
  const value = entity as Appointment;
  return {
    customer_id: value.customerId,
    appointment_type_id: value.appointmentTypeId,
    title: value.title,
    starts_at: value.startsAt,
    ends_at: value.endsAt,
    status: value.status,
    notes: value.notes,
  };
}
function insertDetails(
  type: AppointmentSyncType,
  entity: AppointmentSyncEntity,
) {
  if (type === 'appointment_type') return details(type, entity);
  const value = entity as Appointment;
  return {
    branch_id: value.branchId,
    created_by: value.createdBy,
    ...details(type, entity),
  };
}
function same(
  type: AppointmentSyncType,
  left: AppointmentSyncEntity,
  right: AppointmentSyncEntity,
) {
  return (
    left.id === right.id &&
    left.businessId === right.businessId &&
    JSON.stringify(details(type, left)) === JSON.stringify(details(type, right))
  );
}

export class CloudAppointmentSyncAdapter implements AppointmentSyncCloudPort {
  constructor(private readonly client: SupabaseClient) {}

  async get(type: AppointmentSyncType, businessId: string, id: string) {
    const { data, error } = await this.client
      .from(table(type))
      .select('*')
      .eq('business_id', businessId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? decode(type, data) : null;
  }
  async push(type: AppointmentSyncType, change: PendingAppointmentChange) {
    const { entity, cloudUpdatedAt } = change;
    if (cloudUpdatedAt === null) {
      const { data, error } = await this.client
        .from(table(type))
        .insert({
          id: entity.id,
          business_id: entity.businessId,
          created_at: entity.createdAt,
          ...insertDetails(type, entity),
        })
        .select('*')
        .single();
      if (!error)
        return { kind: 'pushed' as const, entity: decode(type, data) };
      if (error.code !== '23505') throw error;
    } else {
      const { data, error } = await this.client
        .from(table(type))
        .update(details(type, entity))
        .eq('business_id', entity.businessId)
        .eq('id', entity.id)
        .eq('updated_at', cloudUpdatedAt)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (data) return { kind: 'pushed' as const, entity: decode(type, data) };
    }
    const remote = await this.get(type, entity.businessId, entity.id);
    if (!remote)
      throw new Error('El registro de agenda no pudo guardarse en Cloud.');
    return {
      kind: same(type, remote, entity)
        ? ('pushed' as const)
        : ('conflict' as const),
      entity: remote,
    };
  }
  async pull(
    type: AppointmentSyncType,
    businessId: string,
    after: AppointmentSyncCursor | null,
    limit: number,
  ) {
    let query = this.client
      .from(table(type))
      .select('*')
      .eq('business_id', businessId);
    if (after)
      query = query.or(
        `updated_at.gt.${after.updatedAt},and(updated_at.eq.${after.updatedAt},id.gt.${after.id})`,
      );
    const { data, error } = await query
      .order('updated_at')
      .order('id')
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => decode(type, row));
  }
}
