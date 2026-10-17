// Sends queued notifications through the Meta Cloud API. Called by the dispatcher, by the
// authenticated retry/resend actions and by the wake-up after a status change. It never
// decides WHETHER a notice exists (the database trigger does, once per job): it only
// delivers rows that were already claimed, so a row is sent by exactly one worker.
import {
  intakeConfig,
  publicOrderSettings,
  whatsAppSettings,
  type GetEnv,
} from './config.ts';
import { consoleLogger, type Logger } from './diagnostics.ts';
import { ApiError } from './http.ts';
import { WhatsAppApiError, type MetaClient } from './meta-client.ts';
import { toCloudApiRecipient } from './phone.ts';
import { randomToken, sha256 } from './token.ts';
import type { NotificationRow, WhatsAppStore } from './whatsapp-store.ts';

export type SenderDeps = {
  store: WhatsAppStore;
  meta: MetaClient;
  getEnv: GetEnv;
  now?: () => number;
  logger?: Logger;
};

export type SendOutcome = {
  id: string;
  status: 'sent' | 'failed';
  code?: string;
  message?: string;
};

const TOKEN_CODES = new Set(['token_invalid', 'token_forbidden']);

async function sendOne(
  deps: SenderDeps,
  row: NotificationRow,
): Promise<SendOutcome> {
  const { store, meta } = deps;
  const fail = async (code: string, message: string): Promise<SendOutcome> => {
    await store.finish(row.id, { ok: false, code, message });
    return { id: row.id, status: 'failed', code, message };
  };
  const integration = await store.getIntegration(row.business_id);
  if (!integration || integration.status === 'disconnected')
    return fail(
      'integration_not_configured',
      'WhatsApp no está configurado para este negocio.',
    );
  if (integration.status === 'error')
    return fail(
      'integration_error',
      'La conexión con WhatsApp necesita revisión (token o configuración). Probá la conexión en Configuración.',
    );
  const token = await store.readToken(integration.access_token_secret_id);
  if (!token)
    return fail(
      'token_missing',
      'No se encontró el token de WhatsApp. Cargalo de nuevo en Configuración.',
    );
  if (!row.photo_job_id)
    return fail(
      'context_missing',
      'La notificación no tiene un pedido asociado.',
    );
  const context = await store.getSendContext(row.business_id, row.photo_job_id);
  if (!context)
    return fail(
      'context_missing',
      'No se encontró el pedido de esta notificación.',
    );

  const now = (deps.now ?? Date.now)();
  const web = intakeConfig(deps.getEnv).webBaseUrl;
  const { trackingDays } = publicOrderSettings(deps.getEnv);
  const settings = whatsAppSettings(deps.getEnv);
  // The message links to a read-only tracking capability minted for this message. The
  // plaintext lives only in the outgoing text; the database keeps its hash.
  const trackingToken = randomToken(32);
  await store.mintTrackingLink({
    business_id: row.business_id,
    photo_job_id: row.photo_job_id,
    token_hash: await sha256(trackingToken),
    expires_at: new Date(now + trackingDays * 86_400_000).toISOString(),
  });
  try {
    const { messageId } = await meta.sendTemplate({
      token,
      phoneNumberId: integration.phone_number_id,
      to: toCloudApiRecipient(row.destination, settings.dropArgentineNine),
      templateName: integration.template_name,
      language: integration.template_language,
      bodyParameters: [
        context.customer_first_name || 'cliente',
        context.order_code,
        `${web}/pedido/${trackingToken}`,
      ],
    });
    await store.finish(row.id, { ok: true, messageId });
    return { id: row.id, status: 'sent' };
  } catch (cause) {
    if (!(cause instanceof WhatsAppApiError)) throw cause;
    if (TOKEN_CODES.has(cause.code) || cause.code === 'phone_number_not_found')
      await store
        .recordCheck(row.business_id, {
          status: 'error',
          displayPhoneNumber: integration.display_phone_number,
          error: cause.message,
        })
        .catch(() => undefined);
    return fail(cause.code, cause.message);
  }
}

/**
 * Claims and sends. `ids` limits the work to specific notifications (retry/resend/job
 * wake-up); null takes the oldest pending ones. Every claimed row ends `sent` or `failed`,
 * even on an unexpected error, so nothing is left in `sending`.
 */
export async function processNotifications(
  deps: SenderDeps,
  ids: string[] | null,
  limit = 20,
): Promise<SendOutcome[]> {
  const logger = deps.logger ?? consoleLogger;
  const claimed = await deps.store.claim(ids, limit);
  const outcomes: SendOutcome[] = [];
  for (const row of claimed) {
    try {
      const outcome = await sendOne(deps, row);
      logger(
        outcome.status === 'sent' ? 'info' : 'warn',
        'whatsapp_notification_processed',
        {
          notificationId: row.id,
          status: outcome.status,
          code: outcome.code,
          attempt: row.attempt_count,
        },
      );
      outcomes.push(outcome);
    } catch (cause) {
      const curated =
        cause instanceof ApiError || cause instanceof WhatsAppApiError;
      logger('error', 'whatsapp_notification_unexpected_error', {
        notificationId: row.id,
        name: cause instanceof Error ? cause.name : typeof cause,
        message: cause instanceof Error ? cause.message : String(cause),
      });
      const code =
        cause instanceof ApiError
          ? cause.code
          : cause instanceof WhatsAppApiError
            ? cause.code
            : 'internal_error';
      const message = curated
        ? (cause as Error).message
        : 'Error interno al enviar el aviso.';
      await deps.store
        .finish(row.id, { ok: false, code, message })
        .catch(() => undefined);
      outcomes.push({ id: row.id, status: 'failed', code, message });
    }
  }
  return outcomes;
}
