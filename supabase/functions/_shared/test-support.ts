// Test doubles for the photo intake handlers. Not shipped: only imported by *.test.ts.
import {
  assertBusinessAdmin,
  type BusinessMembershipAuthorization,
} from './authorization.ts';
import { DatabaseError } from './diagnostics.ts';
import type {
  DriveFileMeta,
  DriveGateway,
  JobFolders,
} from './google-drive.ts';
import { ApiError } from './http.ts';
import type {
  DriveIntegrationRow,
  FileRow,
  FileStatus,
  IntakeStatus,
  JobContextRow,
  PhotoIntakeStore,
  UploadLinkRow,
} from './store.ts';
import { routeFolderPlan } from './folder-plan.ts';

export const BUSINESS_A = '11111111-1111-4111-8111-111111111111';
export const BUSINESS_B = '22222222-2222-4222-8222-222222222222';
export const JOB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const JOB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const JOB_NO_FILES = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const ITEM_LAB = 'dddddddd-0000-4000-8000-00000000000a';
export const ITEM_EDIT = 'dddddddd-0000-4000-8000-00000000000b';
export const ITEM_PLAIN = 'dddddddd-0000-4000-8000-00000000000c';
export const OWNER = 'user-owner';
export const ADMIN = 'user-admin';
export const STAFF = 'user-staff';

export const ENV: Record<string, string> = {
  PHOTO_UPLOAD_SIGNING_SECRET: 'unit-test-signing-secret-0123456789abcdef',
  PUBLIC_WEB_URL: 'https://centro-color-web.vercel.app',
  WEB_APP_URL: 'https://centro-color-web.vercel.app',
  PHOTO_UPLOAD_LINK_DAYS: '14',
  PHOTO_UPLOAD_MAX_BYTES: '2147483648',
  GOOGLE_DRIVE_CLIENT_ID: 'client-id',
  GOOGLE_DRIVE_CLIENT_SECRET: 'client-secret',
};
export const getEnv = (name: string) => ENV[name];

export type StoreState = {
  integrations: DriveIntegrationRow[];
  jobs: JobContextRow[];
  links: (UploadLinkRow & {
    token_hash: string;
    created_by: string | null;
  })[];
  files: FileRow[];
  folders: Map<string, string>;
  refreshTokens: Map<string, string>;
  /** Operation names ("photo_job_upload_links.insert") that must fail like a DB error. */
  failures: Set<string>;
  calls: string[];
};

const integration = (
  businessId: string,
  status: DriveIntegrationRow['status'] = 'connected',
): DriveIntegrationRow => ({
  business_id: businessId,
  status,
  google_account_email: 'owner@example.com',
  root_folder_id: `root-${businessId.slice(0, 4)}`,
  refresh_token_secret_id: `secret-${businessId.slice(0, 4)}`,
  connected_at: '2026-10-17T00:00:00Z',
});

const job = (
  id: string,
  businessId: string,
  items: JobContextRow['items'],
  overrides: Partial<JobContextRow> = {},
): JobContextRow => ({
  id,
  business_id: businessId,
  status: 'received',
  file_intake_status: 'not_requested',
  source_channel: 'manual',
  is_draft: false,
  created_at: '2026-10-16T12:00:00Z',
  drive_folder_id: null,
  drive_edited_folder_id: null,
  customer_name: 'María García',
  business_name: 'CentroColor',
  items,
  ...overrides,
});

export function seedState(): StoreState {
  return {
    integrations: [integration(BUSINESS_A), integration(BUSINESS_B)],
    jobs: [
      job(JOB_A, BUSINESS_A, [
        {
          id: ITEM_LAB,
          is_active: true,
          service_name_snapshot: 'Foto 10x15',
          quantity: 4,
          width_mm: 100,
          height_mm: 150,
          workflow_route: 'lab',
          requires_customer_files: true,
        },
        {
          id: ITEM_EDIT,
          is_active: true,
          service_name_snapshot: 'Restauración',
          quantity: 1,
          width_mm: null,
          height_mm: null,
          workflow_route: 'editing',
          requires_customer_files: true,
        },
        {
          id: ITEM_PLAIN,
          is_active: true,
          service_name_snapshot: 'Marco',
          quantity: 1,
          width_mm: null,
          height_mm: null,
          workflow_route: 'none',
          requires_customer_files: false,
        },
      ]),
      job(JOB_NO_FILES, BUSINESS_A, [
        {
          id: 'dddddddd-0000-4000-8000-0000000000ff',
          is_active: true,
          service_name_snapshot: 'Marco',
          quantity: 1,
          width_mm: null,
          height_mm: null,
          workflow_route: 'none',
          requires_customer_files: false,
        },
      ]),
      job(JOB_B, BUSINESS_B, [
        {
          id: 'eeeeeeee-0000-4000-8000-00000000000a',
          is_active: true,
          service_name_snapshot: 'Foto 13x18',
          quantity: 2,
          width_mm: 130,
          height_mm: 180,
          workflow_route: 'lab',
          requires_customer_files: true,
        },
      ]),
    ],
    links: [],
    files: [],
    folders: new Map(),
    refreshTokens: new Map([
      [`secret-${BUSINESS_A.slice(0, 4)}`, 'refresh-a'],
      [`secret-${BUSINESS_B.slice(0, 4)}`, 'refresh-b'],
    ]),
    failures: new Set(),
    calls: [],
  };
}

export function createFakeStore(state: StoreState): PhotoIntakeStore {
  let sequence = 0;
  const track = (operation: string) => {
    state.calls.push(operation);
    if (state.failures.has(operation))
      throw new DatabaseError(operation, {
        code: '42501',
        message: 'permission denied for table',
      });
  };
  const findJob = (businessId: string, jobId: string) =>
    state.jobs.find((x) => x.business_id === businessId && x.id === jobId) ??
    null;
  return {
    async getIntegration(businessId) {
      track('google_drive_integrations.get');
      return (
        state.integrations.find((x) => x.business_id === businessId) ?? null
      );
    },
    async markIntegrationStatus(businessId, status) {
      track('google_drive_integrations.mark_status');
      for (const row of state.integrations)
        if (row.business_id === businessId) row.status = status;
    },
    async markIntegrationDisconnected(businessId) {
      track('google_drive_integrations.disconnect');
      for (const row of state.integrations)
        if (row.business_id === businessId) row.status = 'disconnected';
    },
    async readRefreshToken(secretId) {
      track('cc_read_google_refresh_token');
      return state.refreshTokens.get(secretId) ?? null;
    },
    async deleteRefreshToken(secretId) {
      track('cc_delete_google_refresh_token');
      state.refreshTokens.delete(secretId);
    },
    async getFolderId(businessId, jobId, key) {
      track('photo_job_drive_folders.get');
      return state.folders.get(`${businessId}|${jobId}|${key}`) ?? null;
    },
    async saveFolderId(businessId, jobId, key, id) {
      track('photo_job_drive_folders.upsert');
      state.folders.set(`${businessId}|${jobId}|${key}`, id);
    },
    async setJobFolders(businessId, jobId, root, edited) {
      track('photo_jobs.set_drive_folders');
      const row = findJob(businessId, jobId);
      if (row) {
        row.drive_folder_id = root;
        row.drive_edited_folder_id = edited;
      }
    },
    async getJob(businessId, jobId) {
      track('photo_jobs.get');
      const row = findJob(businessId, jobId);
      return row
        ? {
            id: row.id,
            business_id: row.business_id,
            status: row.status,
            file_intake_status: row.file_intake_status,
          }
        : null;
    },
    async getJobContext(businessId, jobId) {
      track('photo_jobs.get_context');
      const row = findJob(businessId, jobId);
      return row ? structuredClone(row) : null;
    },
    async setIntakeStatus(businessId, jobId, status: IntakeStatus) {
      track('photo_jobs.set_intake_status');
      const row = findJob(businessId, jobId);
      if (row) row.file_intake_status = status;
    },
    async getLinkByHash(hash) {
      track('photo_job_upload_links.get_by_hash');
      return state.links.find((x) => x.token_hash === hash) ?? null;
    },
    async getLatestLink(businessId, jobId) {
      track('photo_job_upload_links.latest');
      return (
        [...state.links]
          .filter(
            (x) =>
              x.business_id === businessId &&
              x.photo_job_id === jobId &&
              x.purpose === 'upload',
          )
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
      );
    },
    async insertLink(link) {
      track('photo_job_upload_links.insert');
      sequence += 1;
      const row = {
        ...link,
        purpose: link.purpose ?? 'upload',
        id: `link-${sequence}`,
        revoked_at: null,
        submitted_at: link.submitted_at ?? null,
        created_at: new Date(
          Date.UTC(2026, 9, 17, 0, 0, sequence),
        ).toISOString(),
      };
      state.links.push(row);
      return row;
    },
    async revokeActiveLinks(businessId, jobId, except) {
      track('photo_job_upload_links.revoke');
      for (const row of state.links)
        if (
          row.business_id === businessId &&
          row.photo_job_id === jobId &&
          row.purpose === 'upload' &&
          row.id !== except &&
          !row.revoked_at
        )
          row.revoked_at = '2026-10-17T00:00:00Z';
    },
    async markLinkSubmitted(linkId) {
      track('photo_job_upload_links.mark_submitted');
      const row = state.links.find((x) => x.id === linkId);
      if (row && !row.submitted_at) row.submitted_at = '2026-10-17T01:00:00Z';
    },
    async countFiles(businessId, jobId, statuses: FileStatus[]) {
      track('photo_job_files.count');
      return state.files.filter(
        (x) =>
          x.business_id === businessId &&
          x.photo_job_id === jobId &&
          statuses.includes(x.status),
      ).length;
    },
    async countFilesCreatedSince(businessId, jobId, since) {
      track('photo_job_files.count_recent');
      return state.files.filter(
        (x) =>
          x.business_id === businessId &&
          x.photo_job_id === jobId &&
          x.created_at >= since,
      ).length;
    },
    async getFile(businessId, jobId, fileId) {
      track('photo_job_files.get');
      return (
        state.files.find(
          (x) =>
            x.id === fileId &&
            x.business_id === businessId &&
            x.photo_job_id === jobId,
        ) ?? null
      );
    },
    async listFiles(businessId, jobId, status) {
      track('photo_job_files.list');
      return state.files.filter(
        (x) =>
          x.business_id === businessId &&
          x.photo_job_id === jobId &&
          x.status === status,
      );
    },
    async insertFile(file) {
      track('photo_job_files.insert');
      sequence += 1;
      const row: FileRow = {
        ...file,
        id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
        uploaded_at: null,
        created_at: new Date(Date.now()).toISOString(),
      };
      state.files.push(row);
      return row;
    },
    async transitionFile(businessId, jobId, fileId, from, to, patch = {}) {
      track('photo_job_files.transition');
      const row = state.files.find(
        (x) =>
          x.id === fileId &&
          x.business_id === businessId &&
          x.photo_job_id === jobId &&
          from.includes(x.status),
      );
      if (!row) return false;
      Object.assign(row, patch, { status: to });
      return true;
    },
  };
}

export type FakeDriveOptions = {
  accessError?: ApiError;
  getFileOverride?: (file: FileRow) => DriveFileMeta | ApiError;
  failOn?: Partial<Record<'init' | 'manifest' | 'folders', ApiError>>;
};

export function createFakeDrive(
  store: PhotoIntakeStore,
  state: StoreState,
  options: FakeDriveOptions = {},
) {
  const record = {
    accessCalls: 0,
    ensureCalls: [] as { jobId: string; itemId?: string }[],
    sessions: [] as {
      metadata: Record<string, unknown>;
      mime: string;
      size: number;
      origin?: string | null;
    }[],
    manifests: [] as { parent: string; jobId: string; text: string }[],
  };
  let ids = 0;
  const drive: DriveGateway = {
    async access(businessId) {
      record.accessCalls += 1;
      if (options.accessError) throw options.accessError;
      return {
        token: 'access-token',
        integration: (await store.getIntegration(businessId))!,
      };
    },
    async ensureFolders(businessId, jobId, itemId) {
      if (options.accessError) throw options.accessError;
      if (options.failOn?.folders) throw options.failOn.folders;
      record.ensureCalls.push({ jobId, itemId });
      const context = await store.getJobContext(businessId, jobId);
      if (!context)
        throw new ApiError('No se encontró el trabajo.', 404, 'job_not_found');
      const root = `job-folder-${jobId.slice(0, 4)}`;
      const base = {
        token: 'access-token',
        job: context,
        root,
        edited: null,
        folder: root,
        route: null,
        item: null,
      } satisfies JobFolders;
      if (!itemId) return base;
      const item = context.items.find((x) => x.id === itemId)!;
      const route = item.workflow_route as 'lab' | 'editing' | 'other';
      const plan = routeFolderPlan(route, item.id, item.service_name_snapshot);
      return {
        ...base,
        item,
        route,
        folder: `${root}/${plan.route.name}/${plan.item.name}`,
      };
    },
    async generateFileId() {
      ids += 1;
      return `drive-file-${ids}`;
    },
    async initializeResumable(_token, metadata, mime, size, origin) {
      if (options.failOn?.init) throw options.failOn.init;
      record.sessions.push({ metadata, mime, size, origin });
      return `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session-${record.sessions.length}`;
    },
    async getFile(_token, id) {
      const file = state.files.find((x) => x.drive_file_id === id);
      if (!file)
        throw new ApiError(
          'El archivo todavía no llegó completo. Reintentá en unos segundos.',
          409,
          'drive_file_missing',
        );
      const result = options.getFileOverride?.(file);
      if (result instanceof ApiError) throw result;
      return (
        result ?? {
          id,
          name: file.stored_filename,
          mimeType: file.mime_type ?? 'image/jpeg',
          size: String(file.size_bytes),
          parents: [file.drive_folder_id],
          trashed: false,
        }
      );
    },
    async putManifest(_token, parent, jobId, text) {
      if (options.failOn?.manifest) throw options.failOn.manifest;
      record.manifests.push({ parent, jobId, text });
    },
  };
  return { drive, record };
}

export type TestUser = {
  id: string;
  memberships: BusinessMembershipAuthorization[];
};

/** Mirrors authenticateAdmin(): JWT -> user -> membership -> role, rejecting before any service use. */
export function fakeAuthenticator(users: Record<string, TestUser>) {
  return async (request: Request, businessId: string) => {
    const header = request.headers.get('Authorization');
    if (!header)
      throw new ApiError('Autorización requerida.', 401, 'unauthorized');
    const user = users[header.replace(/^Bearer /, '')];
    if (!user)
      throw new ApiError('Autorización inválida.', 401, 'unauthorized');
    const membership =
      user.memberships.find(
        (x) => x.business_id === businessId && x.is_active,
      ) ?? null;
    assertBusinessAdmin(user.id, businessId, membership);
    return { user: { id: user.id }, membership: membership! };
  };
}

export const membership = (
  userId: string,
  businessId: string,
  role: string,
  isActive = true,
): BusinessMembershipAuthorization => ({
  user_id: userId,
  business_id: businessId,
  role,
  is_active: isActive,
});

export const defaultUsers: Record<string, TestUser> = {
  'jwt-owner': {
    id: OWNER,
    memberships: [membership(OWNER, BUSINESS_A, 'owner')],
  },
  'jwt-admin': {
    id: ADMIN,
    memberships: [membership(ADMIN, BUSINESS_A, 'admin')],
  },
  'jwt-staff': {
    id: STAFF,
    memberships: [membership(STAFF, BUSINESS_A, 'staff')],
  },
  'jwt-owner-b': {
    id: 'user-owner-b',
    memberships: [membership('user-owner-b', BUSINESS_B, 'owner')],
  },
};

export function jsonRequest(
  body: unknown,
  headers: Record<string, string> = {},
  method = 'POST',
) {
  return new Request('https://project.supabase.co/functions/v1/test', {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}
