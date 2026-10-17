/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client boundary. */
import { DatabaseError } from './diagnostics.ts';
import type {
  DriveIntegrationRow,
  FileRow,
  FileStatus,
  IntakeStatus,
  JobContextRow,
  JobRow,
  PhotoIntakeStore,
  UploadLinkRow,
} from './store.ts';

/** Structural subset of a supabase-js client (service role) used by the store. */
export type ServiceDb = {
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): any;
};

type Result = { data: any; error: unknown; count?: number | null };

async function run(
  operation: string,
  query: PromiseLike<Result>,
): Promise<Result> {
  const result = await query;
  if (result.error) throw new DatabaseError(operation, result.error);
  return result;
}

const unique = <T>(values: (T | null | undefined)[]) => [
  ...new Set(values.filter((x): x is T => x != null)),
];

const linkColumns =
  'id,business_id,photo_job_id,expires_at,revoked_at,submitted_at,created_at';

export function createPhotoIntakeStore(db: ServiceDb): PhotoIntakeStore {
  return {
    async getIntegration(businessId) {
      const { data } = await run(
        'google_drive_integrations.get',
        db
          .from('google_drive_integrations')
          .select(
            'business_id,status,google_account_email,root_folder_id,refresh_token_secret_id,connected_at',
          )
          .eq('business_id', businessId)
          .maybeSingle(),
      );
      return (data as DriveIntegrationRow | null) ?? null;
    },
    async markIntegrationStatus(businessId, status) {
      await run(
        'google_drive_integrations.mark_status',
        db
          .from('google_drive_integrations')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('business_id', businessId),
      );
    },
    async markIntegrationDisconnected(businessId) {
      const now = new Date().toISOString();
      await run(
        'google_drive_integrations.disconnect',
        db
          .from('google_drive_integrations')
          .update({
            status: 'disconnected',
            disconnected_at: now,
            updated_at: now,
          })
          .eq('business_id', businessId),
      );
    },
    async readRefreshToken(secretId) {
      const { data } = await run(
        'cc_read_google_refresh_token',
        db.rpc('cc_read_google_refresh_token', { p_secret_id: secretId }),
      );
      return typeof data === 'string' && data ? data : null;
    },
    async deleteRefreshToken(secretId) {
      await run(
        'cc_delete_google_refresh_token',
        db.rpc('cc_delete_google_refresh_token', { p_secret_id: secretId }),
      );
    },
    async getFolderId(businessId, jobId, key) {
      const { data } = await run(
        'photo_job_drive_folders.get',
        db
          .from('photo_job_drive_folders')
          .select('drive_folder_id')
          .eq('business_id', businessId)
          .eq('photo_job_id', jobId)
          .eq('folder_key', key)
          .maybeSingle(),
      );
      return (data?.drive_folder_id as string | undefined) ?? null;
    },
    async saveFolderId(businessId, jobId, key, driveFolderId) {
      await run(
        'photo_job_drive_folders.upsert',
        db.from('photo_job_drive_folders').upsert(
          {
            business_id: businessId,
            photo_job_id: jobId,
            folder_key: key,
            drive_folder_id: driveFolderId,
          },
          { onConflict: 'business_id,photo_job_id,folder_key' },
        ),
      );
    },
    async setJobFolders(businessId, jobId, rootFolderId, editedFolderId) {
      await run(
        'photo_jobs.set_drive_folders',
        db
          .from('photo_jobs')
          .update({
            drive_folder_id: rootFolderId,
            drive_edited_folder_id: editedFolderId,
          })
          .eq('business_id', businessId)
          .eq('id', jobId),
      );
    },

    async getJob(businessId, jobId) {
      const { data } = await run(
        'photo_jobs.get',
        db
          .from('photo_jobs')
          .select('id,business_id,status,file_intake_status')
          .eq('business_id', businessId)
          .eq('id', jobId)
          .maybeSingle(),
      );
      return (data as JobRow | null) ?? null;
    },
    async getJobContext(businessId, jobId) {
      const { data: job } = await run(
        'photo_jobs.get_context',
        db
          .from('photo_jobs')
          .select(
            'id,business_id,status,file_intake_status,created_at,customer_id,drive_folder_id,drive_edited_folder_id',
          )
          .eq('business_id', businessId)
          .eq('id', jobId)
          .maybeSingle(),
      );
      if (!job) return null;
      const [customer, business, items] = await Promise.all([
        run(
          'customers.get_name',
          db
            .from('customers')
            .select('full_name')
            .eq('business_id', businessId)
            .eq('id', job.customer_id)
            .maybeSingle(),
        ),
        run(
          'businesses.get_name',
          db
            .from('businesses')
            .select('name')
            .eq('id', businessId)
            .maybeSingle(),
        ),
        run(
          'photo_job_items.list',
          db
            .from('photo_job_items')
            .select(
              'id,photo_service_id,service_name_snapshot,quantity,width_mm,height_mm,is_active',
            )
            .eq('business_id', businessId)
            .eq('photo_job_id', jobId)
            .order('created_at', { ascending: true }),
        ),
      ]);
      const rows = (items.data ?? []) as any[];
      const serviceIds = unique<string>(rows.map((x) => x.photo_service_id));
      const services = serviceIds.length
        ? ((
            await run(
              'photo_services.list',
              db
                .from('photo_services')
                .select('id,workflow_route,requires_customer_files')
                .eq('business_id', businessId)
                .in('id', serviceIds),
            )
          ).data as any[])
        : [];
      const byId = new Map(services.map((x) => [x.id as string, x]));
      return {
        id: job.id,
        business_id: job.business_id,
        status: job.status,
        file_intake_status: job.file_intake_status,
        created_at: job.created_at,
        drive_folder_id: job.drive_folder_id ?? null,
        drive_edited_folder_id: job.drive_edited_folder_id ?? null,
        customer_name: String(customer.data?.full_name ?? ''),
        business_name: String(business.data?.name ?? ''),
        items: rows.map((x) => {
          const service = x.photo_service_id
            ? byId.get(x.photo_service_id)
            : undefined;
          return {
            id: x.id,
            is_active: x.is_active,
            service_name_snapshot: x.service_name_snapshot,
            quantity: x.quantity,
            width_mm: x.width_mm,
            height_mm: x.height_mm,
            workflow_route: service?.workflow_route ?? null,
            requires_customer_files: service?.requires_customer_files ?? false,
          };
        }),
      } satisfies JobContextRow;
    },
    async setIntakeStatus(businessId, jobId, status: IntakeStatus) {
      await run(
        'photo_jobs.set_intake_status',
        db
          .from('photo_jobs')
          .update({ file_intake_status: status })
          .eq('business_id', businessId)
          .eq('id', jobId),
      );
    },

    async getLinkByHash(tokenHash) {
      const { data } = await run(
        'photo_job_upload_links.get_by_hash',
        db
          .from('photo_job_upload_links')
          .select(linkColumns)
          .eq('token_hash', tokenHash)
          .maybeSingle(),
      );
      return (data as UploadLinkRow | null) ?? null;
    },
    async getLatestLink(businessId, jobId) {
      const { data } = await run(
        'photo_job_upload_links.latest',
        db
          .from('photo_job_upload_links')
          .select(linkColumns)
          .eq('business_id', businessId)
          .eq('photo_job_id', jobId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      return (data as UploadLinkRow | null) ?? null;
    },
    async insertLink(link) {
      const { data } = await run(
        'photo_job_upload_links.insert',
        db
          .from('photo_job_upload_links')
          .insert(link)
          .select(linkColumns)
          .single(),
      );
      return data as UploadLinkRow;
    },
    async revokeActiveLinks(businessId, jobId, exceptLinkId) {
      let query = db
        .from('photo_job_upload_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('business_id', businessId)
        .eq('photo_job_id', jobId)
        .is('revoked_at', null);
      if (exceptLinkId) query = query.neq('id', exceptLinkId);
      await run('photo_job_upload_links.revoke', query);
    },
    async markLinkSubmitted(linkId) {
      await run(
        'photo_job_upload_links.mark_submitted',
        db
          .from('photo_job_upload_links')
          .update({ submitted_at: new Date().toISOString() })
          .eq('id', linkId)
          .is('submitted_at', null),
      );
    },

    async countFiles(businessId, jobId, statuses: FileStatus[]) {
      const { count } = await run(
        'photo_job_files.count',
        db
          .from('photo_job_files')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('photo_job_id', jobId)
          .in('status', statuses),
      );
      return count ?? 0;
    },
    async countFilesCreatedSince(businessId, jobId, sinceIso) {
      const { count } = await run(
        'photo_job_files.count_recent',
        db
          .from('photo_job_files')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('photo_job_id', jobId)
          .gte('created_at', sinceIso),
      );
      return count ?? 0;
    },
    async getFile(businessId, jobId, fileId) {
      const { data } = await run(
        'photo_job_files.get',
        db
          .from('photo_job_files')
          .select('*')
          .eq('id', fileId)
          .eq('business_id', businessId)
          .eq('photo_job_id', jobId)
          .maybeSingle(),
      );
      return (data as FileRow | null) ?? null;
    },
    async listFiles(businessId, jobId, status) {
      const { data } = await run(
        'photo_job_files.list',
        db
          .from('photo_job_files')
          .select('*')
          .eq('business_id', businessId)
          .eq('photo_job_id', jobId)
          .eq('status', status)
          .order('created_at', { ascending: true }),
      );
      return (data ?? []) as FileRow[];
    },
    async insertFile(file) {
      const { data } = await run(
        'photo_job_files.insert',
        db.from('photo_job_files').insert(file).select('*').single(),
      );
      return data as FileRow;
    },
    async transitionFile(businessId, jobId, fileId, from, to, patch = {}) {
      const { data } = await run(
        'photo_job_files.transition',
        db
          .from('photo_job_files')
          .update({ ...patch, status: to })
          .eq('id', fileId)
          .eq('business_id', businessId)
          .eq('photo_job_id', jobId)
          .in('status', from)
          .select('id'),
      );
      return ((data as unknown[] | null) ?? []).length > 0;
    },
  };
}
