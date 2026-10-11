import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AppointmentListQuery,
  AppointmentRepository,
  AppointmentSummary,
} from '@centrocolor/application';
import {
  type Appointment,
  type AppointmentDetails,
  type AppointmentStatus,
  type AppointmentType,
  type AppointmentTypeDetails,
} from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';

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

const fromType = (row: TypeRow): AppointmentType => ({
  id: row.id,
  businessId: row.business_id,
  name: row.name,
  defaultDurationMinutes: row.default_duration_minutes,
  isActive: row.is_active,
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
const typeDetails = (details: AppointmentTypeDetails) => ({
  name: details.name,
  default_duration_minutes: details.defaultDurationMinutes,
});
const appointmentDetails = (details: AppointmentDetails) => ({
  customer_id: details.customerId,
  appointment_type_id: details.appointmentTypeId,
  title: details.title,
  starts_at: details.startsAt,
  ends_at: details.endsAt,
  notes: details.notes,
});

export class SupabaseAppointmentRepository implements AppointmentRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async listTypes(businessId: string, includeInactive = false) {
    let query = this.client
      .from('appointment_types')
      .select('*')
      .eq('business_id', businessId)
      .order('is_active', { ascending: false })
      .order('name');
    if (!includeInactive) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data as TypeRow[]).map(fromType);
  }
  async getType(businessId: string, id: string) {
    const { data, error } = await this.client
      .from('appointment_types')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? fromType(data as TypeRow) : null;
  }
  async createType(type: AppointmentType) {
    const { data, error } = await this.client
      .from('appointment_types')
      .insert({
        id: type.id,
        business_id: type.businessId,
        ...typeDetails(type),
        is_active: type.isActive,
        created_at: type.createdAt,
      })
      .select('*')
      .single();
    if (error) throw error;
    return fromType(data as TypeRow);
  }
  async updateType(
    businessId: string,
    id: string,
    details: AppointmentTypeDetails,
  ) {
    const { data, error } = await this.client
      .from('appointment_types')
      .update(typeDetails(details))
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromType(data as TypeRow);
  }
  async setTypeActive(businessId: string, id: string, active: boolean) {
    const { data, error } = await this.client
      .from('appointment_types')
      .update({ is_active: active })
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromType(data as TypeRow);
  }

  async list(query: AppointmentListQuery): Promise<AppointmentSummary[]> {
    let request = this.client
      .from('appointments')
      .select('*')
      .eq('business_id', query.businessId)
      .eq('branch_id', query.branchId)
      .gte('starts_at', query.from)
      .lt('starts_at', query.to)
      .order('starts_at')
      .limit(query.limit);
    if (query.status) request = request.eq('status', query.status);
    const { data, error } = await request;
    if (error) throw error;
    return this.summaries(
      query.businessId,
      (data as AppointmentRow[]).map(fromAppointment),
      query.query,
    );
  }
  async get(businessId: string, id: string) {
    const { data, error } = await this.client
      .from('appointments')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? fromAppointment(data as AppointmentRow) : null;
  }
  async create(appointment: Appointment) {
    const { data, error } = await this.client
      .from('appointments')
      .insert({
        id: appointment.id,
        business_id: appointment.businessId,
        branch_id: appointment.branchId,
        ...appointmentDetails(appointment),
        status: appointment.status,
        created_by: appointment.createdBy,
        created_at: appointment.createdAt,
      })
      .select('*')
      .single();
    if (error) throw error;
    return fromAppointment(data as AppointmentRow);
  }
  async update(businessId: string, id: string, details: AppointmentDetails) {
    const { data, error } = await this.client
      .from('appointments')
      .update(appointmentDetails(details))
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromAppointment(data as AppointmentRow);
  }
  async setStatus(businessId: string, id: string, status: AppointmentStatus) {
    const { data, error } = await this.client
      .from('appointments')
      .update({ status })
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromAppointment(data as AppointmentRow);
  }
  async overlaps(
    businessId: string,
    branchId: string,
    startsAt: string,
    endsAt: string,
    excludeId?: string,
  ) {
    let request = this.client
      .from('appointments')
      .select('*')
      .eq('business_id', businessId)
      .eq('branch_id', branchId)
      .eq('status', 'scheduled')
      .lt('starts_at', endsAt)
      .gt('ends_at', startsAt)
      .order('starts_at')
      .limit(20);
    if (excludeId) request = request.neq('id', excludeId);
    const { data, error } = await request;
    if (error) throw error;
    return this.summaries(
      businessId,
      (data as AppointmentRow[]).map(fromAppointment),
    );
  }

  private async summaries(
    businessId: string,
    appointments: Appointment[],
    filter?: string,
  ): Promise<AppointmentSummary[]> {
    if (!appointments.length) return [];
    const customerIds = [...new Set(appointments.map((row) => row.customerId))];
    const typeIds = [
      ...new Set(
        appointments.flatMap((row) =>
          row.appointmentTypeId ? [row.appointmentTypeId] : [],
        ),
      ),
    ];
    const [customers, types] = await Promise.all([
      this.client
        .from('customers')
        .select('id,full_name')
        .eq('business_id', businessId)
        .in('id', customerIds),
      typeIds.length
        ? this.client
            .from('appointment_types')
            .select('id,name')
            .eq('business_id', businessId)
            .in('id', typeIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (customers.error) throw customers.error;
    if (types.error) throw types.error;
    const customerNames = new Map(
      (customers.data as { id: string; full_name: string }[]).map((row) => [
        row.id,
        row.full_name,
      ]),
    );
    const typeNames = new Map(
      (types.data as { id: string; name: string }[]).map((row) => [
        row.id,
        row.name,
      ]),
    );
    const summaries = appointments.map((appointment) => ({
      ...appointment,
      customerName: customerNames.get(appointment.customerId) ?? 'Cliente',
      appointmentTypeName: appointment.appointmentTypeId
        ? (typeNames.get(appointment.appointmentTypeId) ?? null)
        : null,
    }));
    const term = filter?.trim().toLocaleLowerCase('es-AR');
    return term
      ? summaries.filter(
          (row) =>
            row.title.toLocaleLowerCase('es-AR').includes(term) ||
            row.customerName.toLocaleLowerCase('es-AR').includes(term),
        )
      : summaries;
  }
}
