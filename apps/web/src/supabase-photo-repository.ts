/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows are mapped at this boundary. */
import type {
  PhotoJobListQuery,
  PhotoRepository,
} from '@centrocolor/application';
import type {
  PhotoJob,
  PhotoJobItem,
  PhotoJobStatus,
  PhotoService,
} from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';
const c = () => getSupabaseClient();
export const photoServiceFromRow = (x: any): PhotoService => ({
  id: x.id,
  businessId: x.business_id,
  code: x.code,
  name: x.name,
  serviceType: x.service_type,
  widthMm: x.width_mm,
  heightMm: x.height_mm,
  defaultUnitPriceCents: x.default_unit_price_cents,
  isActive: x.is_active,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});
export const photoJobFromRow = (x: any): PhotoJob => ({
  id: x.id,
  businessId: x.business_id,
  branchId: x.branch_id,
  customerId: x.customer_id,
  status: x.status,
  priority: x.priority,
  promisedAt: x.promised_at,
  notes: x.notes,
  sourceAppointmentId: x.source_appointment_id,
  sourceEventId: x.source_event_id,
  createdBy: x.created_by,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});
export const photoItemFromRow = (x: any): PhotoJobItem => ({
  id: x.id,
  businessId: x.business_id,
  photoJobId: x.photo_job_id,
  photoServiceId: x.photo_service_id,
  serviceNameSnapshot: x.service_name_snapshot,
  quantity: x.quantity,
  unitPriceCents: x.unit_price_cents,
  totalCents: x.total_cents,
  notes: x.notes,
  widthMm: x.width_mm,
  heightMm: x.height_mm,
  isActive: x.is_active,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});
const servicePayload = (x: any) => ({
  id: x.id,
  business_id: x.businessId,
  code: x.code,
  name: x.name,
  service_type: x.serviceType,
  width_mm: x.widthMm,
  height_mm: x.heightMm,
  default_unit_price_cents: x.defaultUnitPriceCents,
  is_active: x.isActive,
  created_at: x.createdAt,
});
const jobPayload = (x: PhotoJob) => ({
  id: x.id,
  business_id: x.businessId,
  branch_id: x.branchId,
  customer_id: x.customerId,
  status: x.status,
  priority: x.priority,
  promised_at: x.promisedAt,
  notes: x.notes,
  source_appointment_id: x.sourceAppointmentId,
  source_event_id: x.sourceEventId,
  created_by: x.createdBy,
  created_at: x.createdAt,
});
const itemPayload = (x: PhotoJobItem) => ({
  id: x.id,
  business_id: x.businessId,
  photo_job_id: x.photoJobId,
  photo_service_id: x.photoServiceId,
  service_name_snapshot: x.serviceNameSnapshot,
  quantity: x.quantity,
  unit_price_cents: x.unitPriceCents,
  total_cents: x.totalCents,
  notes: x.notes,
  width_mm: x.widthMm,
  height_mm: x.heightMm,
  is_active: x.isActive,
  created_at: x.createdAt,
});
export class SupabasePhotoRepository implements PhotoRepository {
  private async one(q: any) {
    const { data, error } = await q.select('*').single();
    if (error) throw error;
    return data;
  }
  async listServices(b: string, all = false) {
    let q = c()
      .from('photo_services')
      .select('*')
      .eq('business_id', b)
      .order('is_active', { ascending: false })
      .order('name');
    if (!all) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(photoServiceFromRow);
  }
  async createService(x: PhotoService) {
    return photoServiceFromRow(
      await this.one(c().from('photo_services').insert(servicePayload(x))),
    );
  }
  async updateService(b: string, id: string, x: any) {
    return photoServiceFromRow(
      await this.one(
        c()
          .from('photo_services')
          .update({
            code: x.code,
            name: x.name,
            service_type: x.serviceType,
            width_mm: x.widthMm,
            height_mm: x.heightMm,
            default_unit_price_cents: x.defaultUnitPriceCents,
          })
          .eq('business_id', b)
          .eq('id', id),
      ),
    );
  }
  async setServiceActive(b: string, id: string, active: boolean) {
    return photoServiceFromRow(
      await this.one(
        c()
          .from('photo_services')
          .update({ is_active: active })
          .eq('business_id', b)
          .eq('id', id),
      ),
    );
  }
  async listJobs(b: string, branch: string, query: PhotoJobListQuery = {}) {
    let q = c()
      .from('photo_jobs')
      .select(
        '*,customers!inner(full_name,phone),photo_job_items(service_name_snapshot,quantity,total_cents,is_active)',
      )
      .eq('business_id', b)
      .eq('branch_id', branch)
      .order('created_at', { ascending: false })
      .limit(query.limit ?? 200);
    if (query.statuses?.length) q = q.in('status', query.statuses);
    if (query.urgentOnly) q = q.eq('priority', 'urgent');
    const { data, error } = await q;
    if (error) throw error;
    const term = query.search?.trim().toLowerCase();
    return (data ?? [])
      .map((x: any) => {
        const active = (x.photo_job_items ?? []).filter(
          (i: any) => i.is_active,
        );
        return {
          job: photoJobFromRow(x),
          customerName: x.customers.full_name,
          customerPhone: x.customers.phone,
          itemSummary: active
            .map((i: any) => `${i.quantity} × ${i.service_name_snapshot}`)
            .join(', '),
          totalCents: active.reduce(
            (s: number, i: any) => s + i.total_cents,
            0,
          ),
        };
      })
      .filter(
        (x: any) =>
          !term ||
          `${x.customerName} ${x.customerPhone ?? ''} ${x.itemSummary} ${x.job.notes ?? ''}`
            .toLowerCase()
            .includes(term),
      );
  }
  async getJob(b: string, id: string) {
    const { data, error } = await c()
      .from('photo_jobs')
      .select('*,customers!inner(full_name,phone),photo_job_items(*)')
      .eq('business_id', b)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      job: photoJobFromRow(data),
      items: (data.photo_job_items ?? [])
        .map(photoItemFromRow)
        .sort((a: PhotoJobItem, b: PhotoJobItem) =>
          a.createdAt.localeCompare(b.createdAt),
        ),
      customerName: data.customers.full_name,
      customerPhone: data.customers.phone,
    };
  }
  async saveJob(x: PhotoJob, items: PhotoJobItem[]) {
    const row = await this.one(c().from('photo_jobs').insert(jobPayload(x)));
    const result = await c()
      .from('photo_job_items')
      .insert(items.map(itemPayload));
    if (result.error) throw result.error;
    return (await this.getJob(x.businessId, row.id))!;
  }
  async updateJob(x: PhotoJob, items: PhotoJobItem[]) {
    const { error } = await c()
      .from('photo_jobs')
      .update({
        customer_id: x.customerId,
        status: x.status,
        priority: x.priority,
        promised_at: x.promisedAt,
        notes: x.notes,
        source_appointment_id: x.sourceAppointmentId,
        source_event_id: x.sourceEventId,
      })
      .eq('business_id', x.businessId)
      .eq('id', x.id);
    if (error) throw error;
    const result = await c()
      .from('photo_job_items')
      .upsert(items.map(itemPayload));
    if (result.error) throw result.error;
    return (await this.getJob(x.businessId, x.id))!;
  }
  async setJobStatus(b: string, id: string, status: PhotoJobStatus) {
    return photoJobFromRow(
      await this.one(
        c()
          .from('photo_jobs')
          .update({ status })
          .eq('business_id', b)
          .eq('id', id),
      ),
    );
  }
}
