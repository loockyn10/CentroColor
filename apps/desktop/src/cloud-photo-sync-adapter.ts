/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase payload mapping is isolated here. */
import type {
  PendingPhotoChange,
  PhotoSyncCloudPort,
  PhotoSyncCursor,
  PhotoSyncType,
} from '@centrocolor/application';
import { getSupabaseClient } from './cloud-config';
const table = (t: PhotoSyncType) =>
  (
    ({
      photo_service: 'photo_services',
      photo_job: 'photo_jobs',
      photo_job_item: 'photo_job_items',
    }) as const
  )[t];
const payload = (t: PhotoSyncType, x: any) =>
  t === 'photo_service'
    ? {
        id: x.id,
        business_id: x.businessId,
        code: x.code,
        name: x.name,
        service_type: x.serviceType,
        width_mm: x.widthMm,
        height_mm: x.heightMm,
        default_unit_price_cents: x.defaultUnitPriceCents,
        workflow_route: x.workflowRoute,
        requires_customer_files: x.requiresCustomerFiles,
        is_public: x.isPublic,
        public_name: x.publicName,
        public_description: x.publicDescription,
        public_sort_order: x.publicSortOrder,
        public_order_enabled: x.publicOrderEnabled,
        is_active: x.isActive,
        created_at: x.createdAt,
      }
    : t === 'photo_job'
      ? {
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
          file_intake_status: x.fileIntakeStatus,
          drive_folder_id: x.driveFolderId,
          drive_edited_folder_id: x.driveEditedFolderId,
          created_by: x.createdBy,
          created_at: x.createdAt,
        }
      : {
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
        };
const decode = (t: PhotoSyncType, r: any): any => {
  const b = {
    id: r.id,
    businessId: r.business_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  return t === 'photo_service'
    ? {
        ...b,
        code: r.code,
        name: r.name,
        serviceType: r.service_type,
        widthMm: r.width_mm,
        heightMm: r.height_mm,
        defaultUnitPriceCents: r.default_unit_price_cents,
        workflowRoute: r.workflow_route,
        requiresCustomerFiles: r.requires_customer_files,
        isPublic: r.is_public ?? false,
        publicName: r.public_name ?? null,
        publicDescription: r.public_description ?? null,
        publicSortOrder: r.public_sort_order ?? 0,
        publicOrderEnabled: r.public_order_enabled ?? false,
        isActive: r.is_active,
      }
    : t === 'photo_job'
      ? {
          ...b,
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
          sourceChannel: r.source_channel ?? 'manual',
          createdBy: r.created_by,
        }
      : {
          ...b,
          photoJobId: r.photo_job_id,
          photoServiceId: r.photo_service_id,
          serviceNameSnapshot: r.service_name_snapshot,
          quantity: r.quantity,
          unitPriceCents: r.unit_price_cents,
          totalCents: r.total_cents,
          notes: r.notes,
          widthMm: r.width_mm,
          heightMm: r.height_mm,
          isActive: r.is_active,
        };
};
const equivalent = (row: any, expected: Record<string, unknown>) =>
  Object.entries(expected).every(([key, value]) => {
    const remote = row[key];
    if (key.endsWith('_at') && value && remote)
      return Date.parse(String(value)) === Date.parse(String(remote));
    return remote === value;
  });
export class CloudPhotoSyncAdapter implements PhotoSyncCloudPort {
  async push(t: PhotoSyncType, change: PendingPhotoChange) {
    const client: any = getSupabaseClient(),
      x: any = change.entity;
    const old = await client
      .from(table(t))
      .select('*')
      .eq('business_id', x.businessId)
      .eq('id', x.id)
      .maybeSingle();
    if (old.error) throw old.error;
    const expected = payload(t, x);
    if (old.data && !change.cloudUpdatedAt) {
      if (equivalent(old.data, expected))
        return { kind: 'pushed' as const, entity: decode(t, old.data) };
      return { kind: 'conflict' as const, entity: decode(t, old.data) };
    }
    if (
      old.data &&
      change.cloudUpdatedAt &&
      old.data.updated_at !== change.cloudUpdatedAt
    )
      return { kind: 'conflict' as const, entity: decode(t, old.data) };
    const result = old.data
      ? await client
          .from(table(t))
          .update(expected)
          .eq('business_id', x.businessId)
          .eq('id', x.id)
          .eq('updated_at', change.cloudUpdatedAt)
          .select('*')
          .maybeSingle()
      : await client.from(table(t)).insert(expected).select('*').single();
    if (result.error) throw result.error;
    if (!result.data) {
      const latest = await client
        .from(table(t))
        .select('*')
        .eq('business_id', x.businessId)
        .eq('id', x.id)
        .single();
      if (latest.error) throw latest.error;
      return { kind: 'conflict' as const, entity: decode(t, latest.data) };
    }
    return { kind: 'pushed' as const, entity: decode(t, result.data) };
  }
  async pull(
    t: PhotoSyncType,
    b: string,
    after: PhotoSyncCursor | null,
    limit: number,
  ) {
    const client: any = getSupabaseClient();
    let q = client
      .from(table(t))
      .select('*')
      .eq('business_id', b)
      .order('updated_at')
      .order('id')
      .limit(limit);
    if (after)
      q = q.or(
        `updated_at.gt.${after.updatedAt},and(updated_at.eq.${after.updatedAt},id.gt.${after.id})`,
      );
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r: any) => decode(t, r));
  }
}
