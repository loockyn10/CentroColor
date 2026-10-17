/* eslint-disable @typescript-eslint/no-explicit-any -- Google Drive JSON boundary. */
import { googleCredentials, type GetEnv } from './config.ts';
import { consoleLogger, type Logger } from './diagnostics.ts';
import { jobFolderPlan, routeFolderPlan } from './folder-plan.ts';
import {
  GOOGLE_REFRESH_REVOKED_CODE,
  GoogleOAuthError,
  refreshGoogleAccessToken,
} from './google-oauth.ts';
import { ApiError } from './http.ts';
import type {
  DriveIntegrationRow,
  JobContextRow,
  JobItemRow,
  PhotoIntakeStore,
  WorkflowRoute,
} from './store.ts';

const driveBase = 'https://www.googleapis.com/drive/v3';
const uploadBase = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Drive file names must not contain path or control characters; keep the extension intact. */
export function sanitizeName(value: string, maxLength = 120) {
  const cleaned = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // eslint-disable-next-line no-control-regex -- Drive names must reject ASCII controls.
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');
  if (!cleaned) return 'Sin nombre';
  if (cleaned.length <= maxLength) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension =
    dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return `${cleaned.slice(0, maxLength - extension.length).trimEnd()}${extension}`;
}

/** Escapes a value for use inside a single-quoted Drive `q` expression. */
export const escapeDriveQuery = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");

export type DriveFileMeta = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  parents?: string[];
  trashed?: boolean;
};

export type JobFolders = {
  token: string;
  job: JobContextRow;
  root: string;
  edited: string | null;
  folder: string;
  route: Exclude<WorkflowRoute, 'none'> | null;
  item: JobItemRow | null;
};

export interface DriveGateway {
  access(
    businessId: string,
  ): Promise<{ token: string; integration: DriveIntegrationRow }>;
  ensureFolders(
    businessId: string,
    jobId: string,
    itemId?: string,
  ): Promise<JobFolders>;
  generateFileId(token: string): Promise<string>;
  initializeResumable(
    token: string,
    metadata: Record<string, unknown>,
    mime: string,
    size: number,
    origin?: string | null,
  ): Promise<string>;
  getFile(token: string, id: string): Promise<DriveFileMeta>;
  putManifest(
    token: string,
    parent: string,
    jobId: string,
    text: string,
  ): Promise<void>;
}

export type DriveGatewayDeps = {
  store: PhotoIntakeStore;
  getEnv: GetEnv;
  fetcher?: typeof fetch;
  logger?: Logger;
};

export function createDriveGateway(deps: DriveGatewayDeps): DriveGateway {
  const { store, getEnv } = deps;
  const fetcher = deps.fetcher ?? fetch;
  const logger = deps.logger ?? consoleLogger;

  async function toApiError(response: Response, operation: string) {
    const payload: any = await response.json().catch(() => null);
    const reason: string | null =
      payload?.error?.errors?.[0]?.reason ?? payload?.error?.status ?? null;
    // Google error bodies carry no credentials; never log request headers.
    logger('error', 'drive_api_error', {
      operation,
      status: response.status,
      reason,
      message: payload?.error?.message ?? null,
    });
    if (response.status === 404)
      return new ApiError(
        'Google Drive no encontró el archivo o la carpeta.',
        404,
        'drive_not_found',
      );
    if (response.status === 401)
      return new ApiError(
        'Google Drive rechazó el acceso. Reconectá la integración.',
        502,
        'drive_unauthorized',
      );
    if (reason === 'storageQuotaExceeded')
      return new ApiError(
        'El Google Drive del negocio no tiene espacio disponible.',
        502,
        'drive_quota_exceeded',
      );
    if (
      response.status === 429 ||
      reason === 'rateLimitExceeded' ||
      reason === 'userRateLimitExceeded'
    )
      return new ApiError(
        'Google Drive está limitando las solicitudes. Reintentá en unos minutos.',
        503,
        'drive_rate_limited',
      );
    if (response.status === 403)
      return new ApiError(
        'Google Drive denegó el acceso a la carpeta del trabajo.',
        502,
        'drive_forbidden',
      );
    if (response.status >= 500)
      return new ApiError(
        'Google Drive no está disponible. Reintentá en unos minutos.',
        503,
        'drive_unavailable',
      );
    return new ApiError(
      'Google Drive rechazó la solicitud.',
      502,
      'drive_error',
    );
  }

  async function request(
    operation: string,
    url: string,
    token: string,
    init: RequestInit = {},
  ) {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch {
      logger('error', 'drive_unreachable', { operation });
      throw new ApiError(
        'No se pudo contactar a Google Drive. Reintentá en unos minutos.',
        503,
        'drive_unreachable',
      );
    }
    if (!response.ok) throw await toApiError(response, operation);
    return response;
  }

  const requestJson = async (
    operation: string,
    url: string,
    token: string,
    init?: RequestInit,
  ): Promise<any> => (await request(operation, url, token, init)).json();

  async function access(businessId: string) {
    const integration = await store.getIntegration(businessId);
    if (!integration || integration.status === 'disconnected')
      throw new ApiError(
        'Google Drive no está conectado.',
        409,
        'drive_not_connected',
      );
    if (integration.status !== 'connected')
      throw new ApiError(
        'Google Drive requiere reconexión.',
        409,
        'drive_reconnect_required',
      );
    const refreshToken = await store.readRefreshToken(
      integration.refresh_token_secret_id,
    );
    if (!refreshToken) {
      await store.markIntegrationStatus(businessId, 'reconnect_required');
      throw new ApiError(
        'Google Drive requiere reconexión.',
        409,
        'drive_reconnect_required',
      );
    }
    const credentials = googleCredentials(getEnv);
    try {
      const token = await refreshGoogleAccessToken(fetcher, {
        ...credentials,
        refreshToken,
      });
      return { token, integration };
    } catch (cause) {
      if (
        cause instanceof GoogleOAuthError &&
        cause.code === GOOGLE_REFRESH_REVOKED_CODE
      ) {
        await store.markIntegrationStatus(businessId, 'reconnect_required');
        throw new ApiError(
          'Google Drive revocó el acceso; volvé a conectar la integración.',
          409,
          'drive_reconnect_required',
        );
      }
      throw cause;
    }
  }

  async function createFolder(
    token: string,
    name: string,
    parentId: string,
    appProperties: Record<string, string>,
  ) {
    return (await requestJson(
      'folders.create',
      `${driveBase}/files?fields=id,name,webViewLink`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          name: sanitizeName(name),
          mimeType: FOLDER_MIME,
          parents: [parentId],
          appProperties,
        }),
      },
    )) as { id: string };
  }

  /** Idempotent: DB mapping first, then Drive lookup by stable appProperties, then create. */
  async function ensureMappedFolder(
    businessId: string,
    jobId: string,
    key: string,
    name: string,
    parentId: string,
    token: string,
  ) {
    const mapped = await store.getFolderId(businessId, jobId, key);
    if (mapped) return mapped;
    const q =
      `'${escapeDriveQuery(parentId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false and ` +
      `appProperties has { key='centrocolor_key' and value='${escapeDriveQuery(key)}' }`;
    const found = await requestJson(
      'folders.find',
      `${driveBase}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`,
      token,
    );
    const id: string =
      found.files?.[0]?.id ??
      (
        await createFolder(token, name, parentId, {
          centrocolor_key: key,
          centrocolor_job_id: jobId,
        })
      ).id;
    await store.saveFolderId(businessId, jobId, key, id);
    return id;
  }

  async function ensureFolders(
    businessId: string,
    jobId: string,
    itemId?: string,
  ): Promise<JobFolders> {
    const { token, integration } = await access(businessId);
    const job = await store.getJobContext(businessId, jobId);
    if (!job)
      throw new ApiError('No se encontró el trabajo.', 404, 'job_not_found');
    let parent = integration.root_folder_id;
    for (const folder of jobFolderPlan(
      job.id,
      job.customer_name,
      job.created_at,
    ))
      parent = await ensureMappedFolder(
        businessId,
        jobId,
        folder.key,
        folder.name,
        parent,
        token,
      );
    const root = parent;
    const editing = job.items.some(
      (x) => x.is_active && x.workflow_route === 'editing',
    );
    const edited = editing
      ? await ensureMappedFolder(
          businessId,
          jobId,
          'edited',
          'Editadas',
          root,
          token,
        )
      : null;
    if (job.drive_folder_id !== root || job.drive_edited_folder_id !== edited)
      await store.setJobFolders(businessId, jobId, root, edited);
    if (!itemId)
      return {
        token,
        job,
        root,
        edited,
        folder: root,
        route: null,
        item: null,
      };
    const item = job.items.find((x) => x.id === itemId && x.is_active);
    if (!item)
      throw new ApiError(
        'El servicio no pertenece a este trabajo.',
        422,
        'item_not_in_job',
      );
    const route = item.workflow_route ?? 'none';
    if (!item.requires_customer_files || route === 'none')
      throw new ApiError(
        'Este servicio no recibe archivos del cliente.',
        422,
        'item_not_uploadable',
      );
    const plan = routeFolderPlan(route, item.id, item.service_name_snapshot);
    const base = await ensureMappedFolder(
      businessId,
      jobId,
      plan.route.key,
      plan.route.name,
      root,
      token,
    );
    const folder = await ensureMappedFolder(
      businessId,
      jobId,
      plan.item.key,
      plan.item.name,
      base,
      token,
    );
    return { token, job, root, edited, folder, route, item };
  }

  return {
    access,
    ensureFolders,
    async generateFileId(token) {
      const result = await requestJson(
        'files.generate_ids',
        `${driveBase}/files/generateIds?count=1&space=drive`,
        token,
      );
      if (!result.ids?.[0])
        throw new ApiError(
          'Google Drive no devolvió un identificador de archivo.',
          502,
          'drive_error',
        );
      return result.ids[0] as string;
    },
    async initializeResumable(token, metadata, mime, size, origin) {
      const response = await request(
        'files.resumable_init',
        `${uploadBase}/files?uploadType=resumable&fields=id,name,mimeType,size,parents`,
        token,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': mime || 'application/octet-stream',
            'X-Upload-Content-Length': String(size),
            // Google only answers the browser's cross-origin PUTs with CORS headers
            // when the session was created for that Origin.
            ...(origin ? { Origin: origin } : {}),
          },
          body: JSON.stringify(metadata),
        },
      );
      const location = response.headers.get('Location');
      if (!location) {
        logger('error', 'drive_resumable_without_location', {
          status: response.status,
        });
        throw new ApiError(
          'No se pudo iniciar la carga resumible en Drive.',
          502,
          'drive_error',
        );
      }
      return location;
    },
    async getFile(token, id) {
      try {
        return (await requestJson(
          'files.get',
          `${driveBase}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,parents,trashed`,
          token,
        )) as DriveFileMeta;
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === 'drive_not_found')
          throw new ApiError(
            'Drive todavía no recibió el archivo completo.',
            409,
            'drive_file_missing',
          );
        throw cause;
      }
    },
    async putManifest(token, parent, jobId, text) {
      const q = `'${escapeDriveQuery(parent)}' in parents and trashed=false and name='PEDIDO.txt'`;
      const found = await requestJson(
        'manifest.find',
        `${driveBase}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`,
        token,
      );
      const existing = found.files?.[0]?.id as string | undefined;
      if (existing) {
        await request(
          'manifest.update',
          `${uploadBase}/files/${encodeURIComponent(existing)}?uploadType=media`,
          token,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: text,
          },
        );
        return;
      }
      const boundary = `cc_${crypto.randomUUID()}`;
      const metadata = JSON.stringify({
        name: 'PEDIDO.txt',
        parents: [parent],
        appProperties: {
          centrocolor_job_id: jobId,
          centrocolor_manifest: 'true',
        },
      });
      await request(
        'manifest.create',
        `${uploadBase}/files?uploadType=multipart`,
        token,
        {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body:
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
            `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`,
        },
      );
    },
  };
}
