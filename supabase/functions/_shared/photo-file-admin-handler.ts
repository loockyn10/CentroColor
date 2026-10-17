import { intakeConfig, type GetEnv } from './config.ts';
import { consoleLogger, type Logger } from './diagnostics.ts';
import type { DriveGateway } from './google-drive.ts';
import { ApiError, body, errorResponse, json, preflight } from './http.ts';
import type { IntakeStatus, PhotoIntakeStore } from './store.ts';
import { randomToken, sha256 } from './token.ts';

export const PHOTO_FILE_ADMIN_ACTIONS = [
  'status',
  'create_link',
  'get_link',
  'revoke_link',
  'disconnect',
] as const;
export type PhotoFileAdminAction = (typeof PHOTO_FILE_ADMIN_ACTIONS)[number];

/** Request body contract shared with apps/web (see photo-file-intake.ts). */
export type PhotoFileAdminPayload = {
  action: PhotoFileAdminAction;
  businessId: string;
  photoJobId?: string;
};

export type AdminDeps = {
  /**
   * Step 1-4 of the admin pattern: verify the caller's JWT, resolve the auth user and
   * require an active owner/admin membership in `businessId`. Must throw ApiError
   * (401/403) otherwise. Nothing privileged happens before this resolves.
   */
  authenticate(
    request: Request,
    businessId: string,
  ): Promise<{ user: { id: string }; membership: { role: string } }>;
  /** Step 5: only now the service-role backed services are created. */
  services(): { store: PhotoIntakeStore; drive: DriveGateway };
  getEnv: GetEnv;
  fetcher?: typeof fetch;
  now?: () => number;
  logger?: Logger;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOSED_JOB_STATUSES = ['delivered', 'cancelled'];

function parsePayload(input: Partial<PhotoFileAdminPayload>) {
  if (!PHOTO_FILE_ADMIN_ACTIONS.includes(input.action as PhotoFileAdminAction))
    throw new ApiError(
      'La acción solicitada no es válida.',
      400,
      'invalid_action',
    );
  if (typeof input.businessId !== 'string' || !UUID.test(input.businessId))
    throw new ApiError('Falta el negocio.', 400, 'invalid_business');
  const jobAction =
    input.action === 'create_link' ||
    input.action === 'get_link' ||
    input.action === 'revoke_link';
  if (
    jobAction &&
    (typeof input.photoJobId !== 'string' || !UUID.test(input.photoJobId))
  )
    throw new ApiError('Falta el trabajo fotográfico.', 400, 'invalid_job');
  return input as PhotoFileAdminPayload;
}

export async function handlePhotoFileAdmin(request: Request, deps: AdminDeps) {
  if (request.method === 'OPTIONS') return preflight();
  const requestId = crypto.randomUUID();
  const logger = deps.logger ?? consoleLogger;
  const now = deps.now ?? Date.now;
  try {
    if (request.method !== 'POST')
      throw new ApiError('Método no permitido.', 405, 'method_not_allowed');
    const input = parsePayload(
      await body<Partial<PhotoFileAdminPayload>>(request),
    );
    if (!request.headers.get('Authorization'))
      throw new ApiError('Autorización requerida.', 401, 'unauthorized');
    const { user, membership } = await deps.authenticate(
      request,
      input.businessId,
    );
    logger('info', 'photo_file_admin_authorized', {
      requestId,
      action: input.action,
      userId: user.id,
      businessId: input.businessId,
      role: membership.role,
      photoJobId: input.photoJobId ?? null,
    });
    const { store, drive } = deps.services();

    if (input.action === 'status') {
      const integration = await store.getIntegration(input.businessId);
      return json({
        status: integration?.status ?? 'disconnected',
        google_account_email: integration?.google_account_email ?? null,
        root_folder_id: integration?.root_folder_id ?? null,
        connected_at: integration?.connected_at ?? null,
      });
    }

    if (input.action === 'disconnect') {
      const integration = await store.getIntegration(input.businessId);
      if (integration) {
        const refresh = await store
          .readRefreshToken(integration.refresh_token_secret_id)
          .catch(() => null);
        if (refresh)
          await (deps.fetcher ?? fetch)(
            `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`,
            { method: 'POST' },
          ).catch(() => undefined);
        await store.deleteRefreshToken(integration.refresh_token_secret_id);
        await store.markIntegrationDisconnected(input.businessId);
      }
      return json({ ok: true });
    }

    const job = await store.getJob(input.businessId, input.photoJobId!);
    if (!job)
      throw new ApiError('No se encontró el trabajo.', 404, 'job_not_found');

    if (input.action === 'get_link') {
      const link = await store.getLatestLink(input.businessId, job.id);
      return json(
        link
          ? {
              id: link.id,
              expires_at: link.expires_at,
              revoked_at: link.revoked_at,
              submitted_at: link.submitted_at,
              created_at: link.created_at,
              url: null,
            }
          : null,
      );
    }

    if (input.action === 'revoke_link') {
      await store.revokeActiveLinks(input.businessId, job.id);
      return json({ ok: true });
    }

    // create_link
    const config = intakeConfig(deps.getEnv);
    if (CLOSED_JOB_STATUSES.includes(job.status))
      throw new ApiError(
        'Este trabajo ya está cerrado y no acepta archivos.',
        409,
        'job_closed',
      );
    await drive.access(input.businessId);
    const context = await store.getJobContext(input.businessId, job.id);
    const uploadable = (context?.items ?? []).filter(
      (x) =>
        x.is_active &&
        x.requires_customer_files &&
        x.workflow_route !== null &&
        x.workflow_route !== 'none',
    );
    if (!uploadable.length)
      throw new ApiError(
        'Este trabajo no tiene servicios configurados para recibir archivos.',
        422,
        'no_uploadable_items',
      );
    const token = randomToken(32);
    const expiresAt = new Date(
      now() + config.linkDays * 86_400_000,
    ).toISOString();
    // Insert first, revoke the others afterwards: a failed insert never leaves the job
    // without a usable link.
    const link = await store.insertLink({
      business_id: input.businessId,
      photo_job_id: job.id,
      token_hash: await sha256(token),
      created_by: user.id,
      expires_at: expiresAt,
    });
    await store.revokeActiveLinks(input.businessId, job.id, link.id);
    const nextStatus: IntakeStatus =
      job.file_intake_status === 'receiving' ? 'receiving' : 'awaiting_files';
    if (job.file_intake_status !== nextStatus)
      await store.setIntakeStatus(input.businessId, job.id, nextStatus);
    logger('info', 'photo_file_admin_link_created', {
      requestId,
      businessId: input.businessId,
      photoJobId: job.id,
      linkId: link.id,
      expiresAt,
    });
    return json({
      id: link.id,
      expires_at: link.expires_at,
      revoked_at: link.revoked_at,
      submitted_at: link.submitted_at,
      url: `${config.webBaseUrl}/enviar/${token}`,
    });
  } catch (cause) {
    return errorResponse(cause, {
      requestId,
      logger,
      context: 'photo_file_admin',
    });
  }
}
