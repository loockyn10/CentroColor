import { intakeConfig, type GetEnv, type IntakeConfig } from './config.ts';
import { consoleLogger, type Logger } from './diagnostics.ts';
import { sanitizeName, type DriveGateway } from './google-drive.ts';
import { GoogleOAuthError } from './google-oauth.ts';
import { ApiError, body, errorResponse, json, preflight } from './http.ts';
import type {
  FileRow,
  JobContextRow,
  JobItemRow,
  PhotoIntakeStore,
} from './store.ts';
import { destinationId, validateUploadToken } from './token.ts';
import {
  ALLOWED_EXTENSIONS,
  MAX_COPIES,
  MAX_FILES_PER_JOB,
  MAX_SESSIONS_PER_MINUTE,
  PUBLIC_ORDER_EXTENSIONS,
  PUBLIC_ORDER_MAX_FILES,
  PUBLIC_ORDER_MAX_FILE_BYTES,
  driveFileError,
} from './upload-policy.ts';

export type PublicDeps = {
  store: PhotoIntakeStore;
  drive: DriveGateway;
  getEnv: GetEnv;
  now?: () => number;
  logger?: Logger;
};

export const CHUNK_SIZE = 8 * 1024 * 1024; // multiple of 256 KiB, required by Drive.
const CLOSED_JOB_STATUSES = ['delivered', 'cancelled'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICE_UNAVAILABLE =
  'El servicio de carga no está disponible por el momento. Avisale a CentroColor e intentá más tarde.';

/** Request body contracts shared with apps/web (see photo-upload-portal.tsx). */
export type UploadContextPayload = { token: string };
export type UploadSessionPayload = {
  token: string;
  destinationId: string;
  filename: string;
  mimeType?: string;
  sizeBytes: number;
  copies?: number;
  previousUploadId?: string;
};
export type UploadFinalizePayload = { token: string; uploadId: string };
export type UploadSubmitPayload = { token: string };

const BUSINESS_SIDE_CODES = new Set([
  'drive_not_connected',
  'drive_reconnect_required',
  'drive_unauthorized',
  'drive_forbidden',
  'drive_quota_exceeded',
  'drive_not_found',
  'drive_error',
  'server_misconfigured',
]);
const RETRYABLE_CODES = new Set([
  'drive_rate_limited',
  'drive_unavailable',
  'drive_unreachable',
]);

/**
 * Customers must not see business-side Drive or configuration details. States the
 * customer can act on (file not yet complete in Drive, verification mismatch, upload
 * not active) keep their own message and status.
 */
function publicFailure(cause: unknown, logger: Logger, requestId: string) {
  const code =
    cause instanceof ApiError || cause instanceof GoogleOAuthError
      ? cause.code
      : null;
  const retryable = code !== null && RETRYABLE_CODES.has(code);
  if (
    !(cause instanceof GoogleOAuthError) &&
    !(code !== null && (BUSINESS_SIDE_CODES.has(code) || retryable))
  )
    return cause;
  logger('error', 'photo_upload_business_side_failure', {
    requestId,
    code,
    message: (cause as Error).message,
  });
  return new ApiError(
    retryable
      ? 'El servicio de archivos está ocupado. Reintentá en unos minutos.'
      : SERVICE_UNAVAILABLE,
    503,
    'storage_unavailable',
  );
}

function config(deps: PublicDeps): IntakeConfig {
  return intakeConfig(deps.getEnv);
}

/** Shared by every public (token-authorized) function: CORS, POST-only, curated errors. */
export async function run(
  request: Request,
  deps: Pick<PublicDeps, 'logger'>,
  context: string,
  handler: (requestId: string, logger: Logger) => Promise<Response>,
) {
  if (request.method === 'OPTIONS') return preflight();
  const requestId = crypto.randomUUID();
  const logger = deps.logger ?? consoleLogger;
  try {
    if (request.method !== 'POST')
      throw new ApiError('Método no permitido.', 405, 'method_not_allowed');
    return await handler(requestId, logger);
  } catch (cause) {
    return errorResponse(publicFailure(cause, logger, requestId), {
      requestId,
      logger,
      context,
    });
  }
}

function assertJobOpen(job: JobContextRow | null): JobContextRow {
  if (!job || CLOSED_JOB_STATUSES.includes(job.status))
    throw new ApiError('Este pedido ya no acepta archivos.', 410, 'job_closed');
  return job;
}

const acceptsFiles = (item: JobItemRow) =>
  item.is_active &&
  item.requires_customer_files &&
  item.workflow_route !== null &&
  item.workflow_route !== 'none';

/** Minimum data for the public portal: no ids, prices, notes, phone or internal state. */
export function handleUploadContext(request: Request, deps: PublicDeps) {
  return run(request, deps, 'photo_upload_context', async () => {
    const { token } = await body<Partial<UploadContextPayload>>(request);
    const { link } = await validateUploadToken(deps.store, token, {
      now: (deps.now ?? Date.now)(),
    });
    const settings = config(deps);
    const job = assertJobOpen(
      await deps.store.getJobContext(link.business_id, link.photo_job_id),
    );
    const destinations = [];
    for (const item of job.items.filter(acceptsFiles))
      destinations.push({
        destinationId: await destinationId(
          settings.signingSecret,
          link.id,
          item.id,
        ),
        name: item.service_name_snapshot,
        quantity: item.quantity,
        widthMm: item.width_mm,
        heightMm: item.height_mm,
        workflowRoute: item.workflow_route,
      });
    return json({
      businessName: job.business_name,
      customerName: job.customer_name.trim().split(/\s+/)[0] ?? '',
      orderCode: `CC-${job.id.slice(0, 8).toUpperCase()}`,
      destinations,
      expiresAt: link.expires_at,
    });
  });
}

function validOrigin(request: Request, fallback: string) {
  const origin = request.headers.get('Origin');
  return origin && /^https?:\/\/[^/\s]+$/.test(origin)
    ? origin
    : new URL(fallback).origin;
}

export function handleUploadSession(request: Request, deps: PublicDeps) {
  return run(
    request,
    deps,
    'photo_upload_session',
    async (requestId, logger) => {
      const input = await body<Partial<UploadSessionPayload>>(request);
      const now = (deps.now ?? Date.now)();
      const { link } = await validateUploadToken(deps.store, input.token, {
        now,
      });
      const settings = config(deps);
      if (typeof input.destinationId !== 'string')
        throw new ApiError(
          'El destino no es válido.',
          400,
          'invalid_destination',
        );
      if (typeof input.filename !== 'string' || !input.filename.trim())
        throw new ApiError(
          'Falta el nombre del archivo.',
          400,
          'invalid_filename',
        );
      const filename = sanitizeName(input.filename);
      const extension = filename.includes('.')
        ? (filename.split('.').pop()?.toLowerCase() ?? '')
        : '';
      if (!ALLOWED_EXTENSIONS.has(extension))
        throw new ApiError(
          'Formato de archivo no admitido.',
          400,
          'invalid_format',
        );
      const mime = (input.mimeType || 'application/octet-stream').toLowerCase();
      if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime))
        throw new ApiError('El tipo MIME no es válido.', 400, 'invalid_mime');
      if (!mime.startsWith('image/') && mime !== 'application/octet-stream')
        throw new ApiError(
          'El tipo MIME no coincide con un archivo fotográfico admitido.',
          400,
          'invalid_mime',
        );
      if (
        typeof input.sizeBytes !== 'number' ||
        !Number.isSafeInteger(input.sizeBytes) ||
        input.sizeBytes <= 0 ||
        input.sizeBytes > settings.maxBytes
      )
        throw new ApiError(
          'El tamaño del archivo no está permitido.',
          400,
          'invalid_size',
        );
      const requestedCopies = input.copies ?? 1;
      if (
        typeof requestedCopies !== 'number' ||
        !Number.isInteger(requestedCopies) ||
        requestedCopies <= 0 ||
        requestedCopies > MAX_COPIES
      )
        throw new ApiError(
          'Cantidad de copias inválida.',
          400,
          'invalid_copies',
        );

      const job = assertJobOpen(
        await deps.store.getJobContext(link.business_id, link.photo_job_id),
      );
      const publicOrder = job.source_channel === 'public_web';
      if (publicOrder) {
        if (!PUBLIC_ORDER_EXTENSIONS.has(extension))
          throw new ApiError(
            'Sólo se aceptan fotos JPG, PNG, HEIC o TIFF.',
            400,
            'invalid_format',
          );
        if (input.sizeBytes > PUBLIC_ORDER_MAX_FILE_BYTES)
          throw new ApiError(
            'La foto supera el tamaño máximo de 100 MB.',
            400,
            'invalid_size',
          );
      }
      let item: JobItemRow | null = null;
      for (const candidate of job.items)
        if (
          (await destinationId(
            settings.signingSecret,
            link.id,
            candidate.id,
          )) === input.destinationId
        )
          item = candidate;
      if (!item || !acceptsFiles(item))
        throw new ApiError(
          'El destino no pertenece a este pedido.',
          403,
          'destination_not_in_job',
        );
      // Copies only apply to lab prints; editing/other keep a single unit per file.
      const copies = item.workflow_route === 'lab' ? requestedCopies : 1;

      const active = await deps.store.countFiles(link.business_id, job.id, [
        'pending',
        'uploading',
        'uploaded',
      ]);
      if (active >= (publicOrder ? PUBLIC_ORDER_MAX_FILES : MAX_FILES_PER_JOB))
        throw new ApiError(
          'Este pedido alcanzó el máximo de archivos.',
          409,
          'too_many_files',
        );
      const recent = await deps.store.countFilesCreatedSince(
        link.business_id,
        job.id,
        new Date(now - 60_000).toISOString(),
      );
      if (recent >= MAX_SESSIONS_PER_MINUTE)
        throw new ApiError(
          'Hay demasiadas cargas en poco tiempo. Esperá un minuto y reintentá.',
          429,
          'rate_limited',
        );
      if (input.previousUploadId && UUID.test(input.previousUploadId))
        await deps.store.transitionFile(
          link.business_id,
          job.id,
          input.previousUploadId,
          ['pending', 'uploading'],
          'failed',
        );

      const folders = await deps.drive.ensureFolders(
        link.business_id,
        job.id,
        item.id,
      );
      const driveId = await deps.drive.generateFileId(folders.token);
      const stored = `${crypto.randomUUID().slice(0, 8)}-${filename}`;
      const file = await deps.store.insertFile({
        business_id: link.business_id,
        photo_job_id: job.id,
        photo_job_item_id: item.id,
        drive_file_id: driveId,
        drive_folder_id: folders.folder,
        original_filename: filename,
        stored_filename: stored,
        mime_type: input.mimeType || null,
        size_bytes: input.sizeBytes,
        copies,
        workflow_route: folders.route!,
        status: 'pending',
      });
      let uploadUrl: string;
      try {
        uploadUrl = await deps.drive.initializeResumable(
          folders.token,
          {
            id: driveId,
            name: stored,
            parents: [folders.folder],
            // Drive limits key+value to 124 bytes per property: keep them short and
            // never include user-controlled text (filenames) here.
            appProperties: {
              centrocolor_job_id: job.id,
              centrocolor_item_id: item.id,
              centrocolor_upload_id: file.id,
              copies: String(copies),
            },
          },
          mime,
          input.sizeBytes,
          validOrigin(request, settings.webBaseUrl),
        );
        await deps.store.transitionFile(
          link.business_id,
          job.id,
          file.id,
          ['pending'],
          'uploading',
        );
      } catch (cause) {
        await deps.store
          .transitionFile(
            link.business_id,
            job.id,
            file.id,
            ['pending'],
            'failed',
          )
          .catch(() => false);
        throw cause;
      }
      if (job.file_intake_status !== 'receiving')
        await deps.store.setIntakeStatus(link.business_id, job.id, 'receiving');
      logger('info', 'photo_upload_session_created', {
        requestId,
        linkId: link.id,
        photoJobId: job.id,
        itemId: item.id,
        uploadId: file.id,
        sizeBytes: input.sizeBytes,
      });
      return json({ uploadId: file.id, uploadUrl, chunkSize: CHUNK_SIZE });
    },
  );
}

export function handleUploadFinalize(request: Request, deps: PublicDeps) {
  return run(
    request,
    deps,
    'photo_upload_finalize',
    async (requestId, logger) => {
      const input = await body<Partial<UploadFinalizePayload>>(request);
      const { link } = await validateUploadToken(deps.store, input.token, {
        now: (deps.now ?? Date.now)(),
      });
      if (typeof input.uploadId !== 'string' || !UUID.test(input.uploadId))
        throw new ApiError('La carga no es válida.', 400, 'invalid_upload');
      const file = await deps.store.getFile(
        link.business_id,
        link.photo_job_id,
        input.uploadId,
      );
      if (!file)
        throw new ApiError(
          'La carga no pertenece a este pedido.',
          404,
          'upload_not_found',
        );
      if (file.status === 'uploaded')
        return json({ ok: true, uploadedAt: file.uploaded_at });
      if (file.status !== 'uploading')
        throw new ApiError(
          'La carga ya no está activa. Reintentá este archivo.',
          409,
          'upload_not_active',
        );
      const { token } = await deps.drive.access(link.business_id);
      const remote = await deps.drive.getFile(token, file.drive_file_id);
      const problem = driveFileError(remote, {
        folderId: file.drive_folder_id,
        sizeBytes: Number(file.size_bytes),
        storedFilename: file.stored_filename,
      });
      if (problem) {
        logger('warn', 'photo_upload_finalize_verification_failed', {
          requestId,
          uploadId: file.id,
          problem,
        });
        throw new ApiError(problem, 409, 'drive_verification_failed');
      }
      const uploadedAt = new Date((deps.now ?? Date.now)()).toISOString();
      const changed = await deps.store.transitionFile(
        link.business_id,
        link.photo_job_id,
        file.id,
        ['uploading'],
        'uploaded',
        {
          mime_type: remote.mimeType ?? file.mime_type,
          uploaded_at: uploadedAt,
        },
      );
      if (!changed) {
        // Lost a race with a concurrent finalize or a retry that failed this attempt.
        const current = await deps.store.getFile(
          link.business_id,
          link.photo_job_id,
          file.id,
        );
        if (current?.status !== 'uploaded')
          throw new ApiError(
            'La carga ya no está activa. Reintentá este archivo.',
            409,
            'upload_not_active',
          );
        return json({ ok: true, uploadedAt: current.uploaded_at });
      }
      return json({ ok: true, uploadedAt });
    },
  );
}

export function buildManifest(
  job: Pick<JobContextRow, 'id' | 'customer_name' | 'items'>,
  files: Pick<
    FileRow,
    'photo_job_item_id' | 'original_filename' | 'copies' | 'workflow_route'
  >[],
) {
  const lines = [
    `Cliente: ${job.customer_name}`,
    `Código Job: CC-${job.id.slice(0, 8).toUpperCase()}`,
    '',
  ];
  const warnings: string[] = [];
  for (const item of job.items.filter((x) => x.is_active)) {
    const own = files.filter((x) => x.photo_job_item_id === item.id);
    if (!own.length) continue;
    const dimensions =
      item.width_mm && item.height_mm
        ? ` (${item.width_mm / 10} x ${item.height_mm / 10} cm)`
        : '';
    lines.push(`${item.service_name_snapshot}${dimensions}`);
    for (const file of own)
      lines.push(
        `${file.original_filename} | ${file.copies} ${file.copies === 1 ? 'copia' : 'copias'}`,
      );
    const copies = own.reduce((sum, file) => sum + file.copies, 0);
    if (own[0]!.workflow_route === 'lab' && copies !== item.quantity)
      warnings.push(
        `${item.service_name_snapshot}: ${copies} copias enviadas de ${item.quantity} pedidas.`,
      );
    lines.push('');
  }
  return { text: lines.join('\r\n'), warnings };
}

export function handleUploadSubmit(request: Request, deps: PublicDeps) {
  return run(
    request,
    deps,
    'photo_upload_submit',
    async (requestId, logger) => {
      const { token } = await body<Partial<UploadSubmitPayload>>(request);
      const { link } = await validateUploadToken(deps.store, token, {
        allowSubmitted: true,
        now: (deps.now ?? Date.now)(),
      });
      if (link.submitted_at) return json({ ok: true, alreadySubmitted: true });
      // A public self-service draft is confirmed by public-photo-order-submit, which
      // reconciles quantities and releases the job. Closing it here would strand it as a
      // hidden draft, so this endpoint refuses it. Reopened (already confirmed) web orders
      // are not drafts and finish through the regular path.
      const context = await deps.store.getJobContext(
        link.business_id,
        link.photo_job_id,
      );
      if (context?.is_draft)
        throw new ApiError(
          'Este pedido se confirma desde la página de pedidos.',
          409,
          'use_public_order_submit',
        );
      const pending =
        (await deps.store.countFiles(link.business_id, link.photo_job_id, [
          'pending',
          'uploading',
        ])) > 0;
      if (pending)
        throw new ApiError(
          'Esperá a que terminen todas las cargas antes de finalizar.',
          409,
          'uploads_pending',
        );
      const files = await deps.store.listFiles(
        link.business_id,
        link.photo_job_id,
        'uploaded',
      );
      if (!files.length)
        throw new ApiError(
          'Todavía no hay archivos completos para finalizar.',
          409,
          'no_uploaded_files',
        );
      const folders = await deps.drive.ensureFolders(
        link.business_id,
        link.photo_job_id,
      );
      const { text, warnings } = buildManifest(folders.job, files);
      await deps.drive.putManifest(
        folders.token,
        folders.root,
        folders.job.id,
        text,
      );
      // Job first, link last: if the second write fails the retry is idempotent.
      await deps.store.setIntakeStatus(
        link.business_id,
        link.photo_job_id,
        'submitted',
      );
      await deps.store.markLinkSubmitted(link.id);
      logger('info', 'photo_upload_submitted', {
        requestId,
        linkId: link.id,
        photoJobId: link.photo_job_id,
        files: files.length,
        warnings: warnings.length,
      });
      return json({ ok: true, warnings });
    },
  );
}
