// HTTP handlers for the WhatsApp integration. Dependencies are injected so they run in tests
// without Deno, Supabase or Meta. Authorization is decided before any privileged service is
// created: owner/admin to configure, any active member to operate jobs, a shared secret for
// the dispatcher and an HMAC signature for Meta's webhook. No response ever carries the token.
import { dispatchSecret, webhookSettings, type GetEnv } from './config.ts';
import { consoleLogger, type Logger } from './diagnostics.ts';
import { ApiError, body, errorResponse, json, preflight } from './http.ts';
import { WhatsAppApiError, type MetaClient } from './meta-client.ts';
import { OrderRuleError } from './public-order-store.ts';
import { processNotifications, type SendOutcome } from './whatsapp-sender.ts';
import type {
  NotificationRow,
  WhatsAppIntegrationRow,
  WhatsAppStore,
} from './whatsapp-store.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d{5,32}$/;
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const TEMPLATE_LANGUAGE = /^[a-z]{2,3}(_[A-Za-z]{2,4})?$/;
const ACCESS_TOKEN = /^[A-Za-z0-9_\-|.]{20,1000}$/;

export type WhatsAppServices = { store: WhatsAppStore; meta: MetaClient };

export type WhatsAppAdminDeps = {
  authenticate(
    request: Request,
    businessId: string,
  ): Promise<{ user: { id: string }; membership: { role: string } }>;
  services(): WhatsAppServices;
  getEnv: GetEnv;
  now?: () => number;
  logger?: Logger;
};

/** What the admin UI may see. There is deliberately no token and no Vault reference here. */
export function integrationView(row: WhatsAppIntegrationRow | null) {
  if (!row)
    return {
      status: 'not_configured' as const,
      phoneNumberId: null,
      wabaId: null,
      displayPhoneNumber: null,
      templateName: null,
      templateLanguage: null,
      configuredAt: null,
      lastCheckedAt: null,
      lastCheckError: null,
    };
  return {
    status: row.status,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    displayPhoneNumber: row.display_phone_number,
    templateName: row.template_name,
    templateLanguage: row.template_language,
    configuredAt: row.configured_at,
    lastCheckedAt: row.last_checked_at,
    lastCheckError: row.last_check_error,
  };
}

export function notificationView(row: NotificationRow) {
  return {
    id: row.id,
    status: row.status,
    triggerKind: row.trigger_kind,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    lastErrorCode: row.last_error_code,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

function invalid(message: string, code = 'invalid_request') {
  return new ApiError(message, 400, code);
}

const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : undefined;

/* ───────────────────────── admin: configure, test, disconnect ───────────────────────── */

export const WHATSAPP_ADMIN_ACTIONS = [
  'status',
  'configure',
  'test',
  'disconnect',
] as const;
export type WhatsAppAdminAction = (typeof WHATSAPP_ADMIN_ACTIONS)[number];

/** Request body contract shared with apps/web (whatsapp-admin.ts). */
export type WhatsAppAdminPayload = {
  action: WhatsAppAdminAction;
  businessId: string;
  phoneNumberId?: string;
  wabaId?: string;
  templateName?: string;
  templateLanguage?: string;
  /** Sent once when configuring; never returned. Omit to keep the stored token. */
  accessToken?: string;
};

export async function handleWhatsAppAdmin(
  request: Request,
  deps: WhatsAppAdminDeps,
) {
  if (request.method === 'OPTIONS') return preflight();
  const requestId = crypto.randomUUID();
  const logger = deps.logger ?? consoleLogger;
  try {
    if (request.method !== 'POST')
      throw new ApiError('Método no permitido.', 405, 'method_not_allowed');
    const input = await body<Partial<WhatsAppAdminPayload>>(request);
    if (!WHATSAPP_ADMIN_ACTIONS.includes(input.action as WhatsAppAdminAction))
      throw invalid('La acción solicitada no es válida.', 'invalid_action');
    if (typeof input.businessId !== 'string' || !UUID.test(input.businessId))
      throw invalid('Falta el negocio.', 'invalid_business');
    if (!request.headers.get('Authorization'))
      throw new ApiError('Autorización requerida.', 401, 'unauthorized');
    const { user } = await deps.authenticate(request, input.businessId);
    const { store, meta } = deps.services();
    const businessId = input.businessId;
    logger('info', 'whatsapp_admin_authorized', {
      requestId,
      action: input.action,
      userId: user.id,
      businessId,
    });

    if (input.action === 'status')
      return json(integrationView(await store.getIntegration(businessId)));

    if (input.action === 'disconnect') {
      await store.disconnect(businessId);
      return json(integrationView(await store.getIntegration(businessId)));
    }

    if (input.action === 'configure') {
      const phoneNumberId = text(input.phoneNumberId);
      const wabaId = text(input.wabaId) || null;
      const templateName = text(input.templateName);
      const templateLanguage = text(input.templateLanguage);
      const accessToken = text(input.accessToken);
      if (!phoneNumberId || !DIGITS.test(phoneNumberId))
        throw invalid(
          'El Phone Number ID debe ser numérico.',
          'invalid_phone_number_id',
        );
      if (wabaId && !DIGITS.test(wabaId))
        throw invalid('El WABA ID debe ser numérico.', 'invalid_waba_id');
      if (!templateName || !TEMPLATE_NAME.test(templateName))
        throw invalid(
          'El nombre de la plantilla sólo admite minúsculas, números y guión bajo.',
          'invalid_template_name',
        );
      if (!templateLanguage || !TEMPLATE_LANGUAGE.test(templateLanguage))
        throw invalid(
          'El idioma de la plantilla no es válido (ej.: es_AR).',
          'invalid_template_language',
        );
      if (
        accessToken !== undefined &&
        accessToken !== '' &&
        !ACCESS_TOKEN.test(accessToken)
      )
        throw invalid(
          'El token de acceso no tiene un formato válido.',
          'invalid_access_token',
        );

      const existing = await store.getIntegration(businessId);
      let secretId = existing?.access_token_secret_id ?? null;
      let created = false;
      if (accessToken) {
        secretId = await store.storeToken(
          accessToken,
          `whatsapp_token_${businessId}_${crypto.randomUUID().slice(0, 8)}`,
        );
        created = true;
      }
      if (!secretId)
        throw new ApiError(
          'Falta el token de acceso de WhatsApp.',
          422,
          'missing_access_token',
        );
      try {
        await store.saveIntegration({
          business_id: businessId,
          phone_number_id: phoneNumberId,
          waba_id: wabaId,
          template_name: templateName,
          template_language: templateLanguage,
          secret_id: secretId,
          actor: user.id,
        });
      } catch (cause) {
        if (created) await store.deleteToken(secretId).catch(() => undefined);
        throw cause;
      }
      logger('info', 'whatsapp_integration_configured', {
        requestId,
        businessId,
        tokenReplaced: created,
      });
      return json(integrationView(await store.getIntegration(businessId)));
    }

    // test
    const integration = await store.getIntegration(businessId);
    if (!integration || integration.status === 'disconnected')
      throw new ApiError(
        'WhatsApp no está configurado.',
        409,
        'not_configured',
      );
    const token = await store.readToken(integration.access_token_secret_id);
    if (!token)
      throw new ApiError(
        'No se encontró el token guardado. Cargalo de nuevo.',
        409,
        'token_missing',
      );
    try {
      const phone = await meta.getPhoneNumber({
        token,
        phoneNumberId: integration.phone_number_id,
      });
      let template: {
        checked: boolean;
        found?: boolean;
        status?: string | null;
      } = {
        checked: false,
      };
      let problem: { code: string; message: string } | null = null;
      if (integration.waba_id) {
        const found = await meta.getTemplate({
          token,
          wabaId: integration.waba_id,
          name: integration.template_name,
          language: integration.template_language,
        });
        template = { checked: true, found: found.found, status: found.status };
        if (!found.found)
          problem = {
            code: 'template_not_found',
            message: `No se encontró la plantilla «${integration.template_name}» en ${integration.template_language}.`,
          };
        else if (found.status !== 'APPROVED')
          problem = {
            code: 'template_not_approved',
            message: `La plantilla está en estado ${found.status ?? 'desconocido'}: sólo se pueden enviar plantillas APPROVED.`,
          };
      }
      await store.recordCheck(businessId, {
        status: 'configured',
        displayPhoneNumber: phone.displayPhoneNumber,
        error: problem?.message ?? null,
      });
      return json({
        ok: problem === null,
        code: problem?.code,
        message: problem?.message,
        displayPhoneNumber: phone.displayPhoneNumber,
        verifiedName: phone.verifiedName,
        template,
        integration: integrationView(await store.getIntegration(businessId)),
      });
    } catch (cause) {
      if (!(cause instanceof WhatsAppApiError)) throw cause;
      const tokenProblem = [
        'token_invalid',
        'token_forbidden',
        'phone_number_not_found',
      ].includes(cause.code);
      await store.recordCheck(businessId, {
        status: tokenProblem ? 'error' : integration.status,
        displayPhoneNumber: integration.display_phone_number,
        error: cause.message,
      });
      return json({
        ok: false,
        code: cause.code,
        message: cause.message,
        integration: integrationView(await store.getIntegration(businessId)),
      });
    }
  } catch (cause) {
    return errorResponse(cause, {
      requestId,
      logger,
      context: 'whatsapp_admin',
    });
  }
}

/* ───────────── member: retry, resend and wake-up of a job's notifications ───────────── */

export const WHATSAPP_SEND_ACTIONS = ['retry', 'resend', 'process'] as const;
export type WhatsAppSendAction = (typeof WHATSAPP_SEND_ACTIONS)[number];

/** Request body contract shared with apps/web (whatsapp-notifications.ts). */
export type WhatsAppSendPayload = {
  action: WhatsAppSendAction;
  businessId: string;
  notificationId?: string;
  photoJobId?: string;
};

export type WhatsAppSendDeps = WhatsAppAdminDeps;

const ruleMessages: Record<string, [number, string]> = {
  not_retryable: [
    409,
    'Este aviso no se puede reintentar en su estado actual.',
  ],
  job_not_found: [404, 'No se encontró el trabajo.'],
  job_not_ready: [
    409,
    'El trabajo tiene que estar en «Listo» para reenviar el aviso.',
  ],
  no_consent: [409, 'El cliente no aceptó recibir avisos por WhatsApp.'],
  no_original_notice: [
    409,
    'Este trabajo no tiene un aviso previo para reenviar.',
  ],
  resend_limit: [429, 'Se alcanzó el máximo de reenvíos para este trabajo.'],
  already_in_flight: [409, 'Ya hay un aviso en curso para este trabajo.'],
};

function ruleToApiError(cause: unknown) {
  if (!(cause instanceof OrderRuleError)) return cause;
  const known = ruleMessages[cause.code];
  return known
    ? new ApiError(known[1], known[0], cause.code)
    : new ApiError('La solicitud no es válida.', 400, 'invalid_request');
}

export async function handleWhatsAppSend(
  request: Request,
  deps: WhatsAppSendDeps,
) {
  if (request.method === 'OPTIONS') return preflight();
  const requestId = crypto.randomUUID();
  const logger = deps.logger ?? consoleLogger;
  try {
    if (request.method !== 'POST')
      throw new ApiError('Método no permitido.', 405, 'method_not_allowed');
    const input = await body<Partial<WhatsAppSendPayload>>(request);
    if (!WHATSAPP_SEND_ACTIONS.includes(input.action as WhatsAppSendAction))
      throw invalid('La acción solicitada no es válida.', 'invalid_action');
    if (typeof input.businessId !== 'string' || !UUID.test(input.businessId))
      throw invalid('Falta el negocio.', 'invalid_business');
    if (!request.headers.get('Authorization'))
      throw new ApiError('Autorización requerida.', 401, 'unauthorized');
    const { user } = await deps.authenticate(request, input.businessId);
    const { store, meta } = deps.services();
    const businessId = input.businessId;
    const sender = { store, meta, getEnv: deps.getEnv, now: deps.now, logger };

    let ids: string[];
    if (input.action === 'retry') {
      if (
        typeof input.notificationId !== 'string' ||
        !UUID.test(input.notificationId)
      )
        throw invalid('Falta el aviso.', 'invalid_notification');
      await store
        .retry(businessId, input.notificationId, user.id)
        .catch((c) => {
          throw ruleToApiError(c);
        });
      ids = [input.notificationId];
    } else if (input.action === 'resend') {
      if (typeof input.photoJobId !== 'string' || !UUID.test(input.photoJobId))
        throw invalid('Falta el trabajo fotográfico.', 'invalid_job');
      ids = [
        await store.resend(businessId, input.photoJobId, user.id).catch((c) => {
          throw ruleToApiError(c);
        }),
      ];
    } else {
      if (typeof input.photoJobId !== 'string' || !UUID.test(input.photoJobId))
        throw invalid('Falta el trabajo fotográfico.', 'invalid_job');
      ids = (await store.listForJob(businessId, input.photoJobId))
        .filter((x) => x.status === 'pending')
        .map((x) => x.id);
    }
    logger('info', 'whatsapp_send_requested', {
      requestId,
      action: input.action,
      userId: user.id,
      businessId,
      count: ids.length,
    });
    const outcomes: SendOutcome[] = ids.length
      ? await processNotifications(sender, ids)
      : [];
    const notifications = [];
    for (const id of ids) {
      const row = await store.getNotification(businessId, id);
      if (row) notifications.push(notificationView(row));
    }
    return json({ notifications, processed: outcomes.length });
  } catch (cause) {
    return errorResponse(cause, {
      requestId,
      logger,
      context: 'whatsapp_send',
    });
  }
}

/* ───────────────────── dispatcher: wake-up from the database ───────────────────── */

export type WhatsAppDispatchDeps = {
  services(): WhatsAppServices;
  getEnv: GetEnv;
  now?: () => number;
  logger?: Logger;
};

function timingSafeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1)
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

export async function handleWhatsAppDispatch(
  request: Request,
  deps: WhatsAppDispatchDeps,
) {
  if (request.method === 'OPTIONS') return preflight();
  const requestId = crypto.randomUUID();
  const logger = deps.logger ?? consoleLogger;
  try {
    if (request.method !== 'POST')
      throw new ApiError('Método no permitido.', 405, 'method_not_allowed');
    const expected = dispatchSecret(deps.getEnv);
    const provided = request.headers.get('x-dispatch-secret') ?? '';
    if (!timingSafeEqual(provided, expected))
      throw new ApiError('No autorizado.', 401, 'unauthorized');
    const { store, meta } = deps.services();
    const outcomes = await processNotifications(
      { store, meta, getEnv: deps.getEnv, now: deps.now, logger },
      null,
      20,
    );
    return json({
      processed: outcomes.length,
      sent: outcomes.filter((x) => x.status === 'sent').length,
      failed: outcomes.filter((x) => x.status === 'failed').length,
    });
  } catch (cause) {
    return errorResponse(cause, {
      requestId,
      logger,
      context: 'whatsapp_dispatch',
    });
  }
}

/* ───────────────────────────── Meta webhook (delivery receipts) ───────────────────────────── */

export type WhatsAppWebhookDeps = {
  store(): WhatsAppStore;
  getEnv: GetEnv;
  logger?: Logger;
};

async function hmacHex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(signature), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}

type WebhookStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string }[];
};

export async function handleWhatsAppWebhook(
  request: Request,
  deps: WhatsAppWebhookDeps,
) {
  const requestId = crypto.randomUUID();
  const logger = deps.logger ?? consoleLogger;
  try {
    const settings = webhookSettings(deps.getEnv);
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (
        url.searchParams.get('hub.mode') === 'subscribe' &&
        timingSafeEqual(
          url.searchParams.get('hub.verify_token') ?? '',
          settings.verifyToken,
        )
      )
        return new Response(url.searchParams.get('hub.challenge') ?? '', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      throw new ApiError('Verificación inválida.', 403, 'forbidden');
    }
    if (request.method !== 'POST')
      throw new ApiError('Método no permitido.', 405, 'method_not_allowed');
    const raw = await request.text();
    const signature = request.headers.get('x-hub-signature-256') ?? '';
    const expected = `sha256=${await hmacHex(settings.appSecret, raw)}`;
    if (!timingSafeEqual(signature, expected))
      throw new ApiError('Firma inválida.', 401, 'invalid_signature');
    let payload: {
      entry?: { changes?: { value?: { statuses?: WebhookStatus[] } }[] }[];
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      throw invalid('La solicitud no es válida.');
    }
    const store = deps.store();
    let applied = 0;
    for (const entry of payload.entry ?? [])
      for (const change of entry.changes ?? [])
        for (const status of change.value?.statuses ?? []) {
          if (
            typeof status.id !== 'string' ||
            !['delivered', 'read', 'failed'].includes(status.status ?? '')
          )
            continue;
          const error = status.errors?.[0];
          const at = Number(status.timestamp);
          if (
            await store.applyStatus({
              messageId: status.id,
              status: status.status as 'delivered' | 'read' | 'failed',
              at:
                Number.isFinite(at) && at > 0
                  ? new Date(at * 1000).toISOString()
                  : null,
              code: error?.code !== undefined ? String(error.code) : null,
              message: error?.title ?? error?.message ?? null,
            })
          )
            applied += 1;
        }
    logger('info', 'whatsapp_webhook_processed', { requestId, applied });
    return json({ ok: true, applied });
  } catch (cause) {
    return errorResponse(cause, {
      requestId,
      logger,
      context: 'whatsapp_webhook',
    });
  }
}
