// Meta WhatsApp Cloud API client (Graph API). Direct integration: no third-party provider
// and no WhatsApp Web automation. The access token is passed per call, never stored here,
// and never appears in a thrown message or a log line.

type GraphPayload = {
  messages?: { id?: string }[];
  display_phone_number?: string;
  verified_name?: string;
  data?: { name?: string; status?: string; language?: string }[];
};

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly httpStatus: number | null = null,
    readonly metaCode: number | null = null,
  ) {
    super(message);
  }
}

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_data?: { details?: string };
  };
};

const trim = (value: string | undefined, max = 140) =>
  value ? value.replace(/\s+/g, ' ').slice(0, max) : '';

/**
 * Maps a Graph API failure to a stable code and a message written for the person who runs
 * the shop. Codes follow Meta's documented error codes for the Cloud API.
 */
export function classifyMetaError(
  httpStatus: number,
  payload: unknown,
  context: { templateName?: string; templateLanguage?: string } = {},
): WhatsAppApiError {
  const error = (payload as MetaErrorBody | null)?.error;
  const meta = error?.code ?? null;
  const sub = error?.error_subcode ?? null;
  const detail = trim(error?.error_data?.details ?? error?.message);
  const make = (code: string, message: string, retryable = false) =>
    new WhatsAppApiError(message, code, retryable, httpStatus, meta);

  if (
    meta === 190 ||
    (error?.type === 'OAuthException' && [102, 463, 467].includes(sub ?? 0)) ||
    httpStatus === 401
  )
    return make(
      'token_invalid',
      'El token de acceso de WhatsApp es inválido o venció. Cargá uno nuevo en Configuración → Integraciones.',
    );
  if (meta === 131031 || meta === 131005 || meta === 10 || meta === 200)
    return make(
      'token_forbidden',
      'El token no tiene permiso para enviar mensajes con este número. Revisá los permisos whatsapp_business_messaging.',
    );
  if (meta === 132001)
    return make(
      'template_not_found',
      `La plantilla «${context.templateName ?? ''}» no existe o no está aprobada en el idioma ${context.templateLanguage ?? ''}. Verificá nombre e idioma en Meta.`,
    );
  if (meta === 132000 || meta === 132012 || meta === 132005 || meta === 132007)
    return make(
      'template_params_mismatch',
      'Los datos del mensaje no coinciden con la plantilla (cantidad o formato de variables). Revisá la plantilla en Meta.',
    );
  if (meta === 132015 || meta === 132016)
    return make(
      'template_unavailable',
      'La plantilla está pausada o deshabilitada por Meta. Revisá su calidad en el administrador de WhatsApp.',
    );
  if (meta === 131030)
    return make(
      'recipient_not_allowed',
      'El número de destino no está en la lista permitida de Meta (el número de prueba sólo envía a números verificados).',
    );
  if (meta === 131026 || meta === 131021 || meta === 131009)
    return make(
      'recipient_unreachable',
      'El número no tiene WhatsApp o no puede recibir el mensaje.',
    );
  if (meta === 131047 || meta === 131051)
    return make(
      'recipient_unreachable',
      'WhatsApp no pudo entregar el mensaje a este número.',
    );
  if (
    meta === 130429 ||
    meta === 131048 ||
    meta === 131056 ||
    meta === 80007 ||
    meta === 4 ||
    meta === 17 ||
    meta === 613 ||
    httpStatus === 429
  )
    return make(
      'rate_limited',
      'Meta limitó temporalmente los envíos. Reintentá en unos minutos.',
      true,
    );
  if (meta === 133010 || meta === 133004 || meta === 133005)
    return make(
      'sender_not_registered',
      'El número emisor no está registrado en WhatsApp Cloud API o está bloqueado.',
    );
  if (
    meta === 100 &&
    (sub === 33 ||
      /does not exist|cannot be loaded|missing permissions/i.test(
        error?.message ?? '',
      ))
  )
    return make(
      'phone_number_not_found',
      'El Phone Number ID no existe o el token no tiene acceso a él.',
    );
  if (httpStatus >= 500 || meta === 1 || meta === 2 || meta === 131000)
    return make(
      'meta_unavailable',
      'Meta no está disponible en este momento. Reintentá más tarde.',
      true,
    );
  return make(
    'meta_error',
    `Meta rechazó la solicitud${meta ? ` (código ${meta})` : ''}${detail ? `: ${detail}` : '.'}`,
  );
}

export type MetaClientDeps = {
  fetcher?: typeof fetch;
  apiVersion: string;
  timeoutMs?: number;
};

export type SendTemplateArgs = {
  token: string;
  phoneNumberId: string;
  /** Digits only, as the Cloud API expects (`wa_id`). */
  to: string;
  templateName: string;
  language: string;
  bodyParameters: string[];
};

/** The exact JSON sent to POST /{phone-number-id}/messages for an approved utility template. */
export function buildTemplatePayload(
  args: Omit<SendTemplateArgs, 'token' | 'phoneNumberId'>,
) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: args.to,
    type: 'template',
    template: {
      name: args.templateName,
      language: { code: args.language },
      components: [
        {
          type: 'body',
          parameters: args.bodyParameters.map((text) => ({
            type: 'text',
            text,
          })),
        },
      ],
    },
  };
}

export interface MetaClient {
  sendTemplate(args: SendTemplateArgs): Promise<{ messageId: string }>;
  getPhoneNumber(args: { token: string; phoneNumberId: string }): Promise<{
    displayPhoneNumber: string | null;
    verifiedName: string | null;
  }>;
  getTemplate(args: {
    token: string;
    wabaId: string;
    name: string;
    language: string;
  }): Promise<{ found: boolean; status: string | null }>;
}

export function createMetaClient(deps: MetaClientDeps): MetaClient {
  const fetcher = deps.fetcher ?? fetch;
  const base = `https://graph.facebook.com/${deps.apiVersion}`;

  async function request(
    token: string,
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
    context: { templateName?: string; templateLanguage?: string } = {},
  ) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      deps.timeoutMs ?? 10_000,
    );
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } catch (cause) {
      const aborted = (cause as Error | undefined)?.name === 'AbortError';
      throw new WhatsAppApiError(
        aborted
          ? 'Meta no respondió a tiempo. El mensaje pudo haberse enviado: verificá antes de reintentar.'
          : 'No se pudo contactar a Meta. Reintentá más tarde.',
        aborted ? 'timeout' : 'network_error',
        true,
      );
    } finally {
      clearTimeout(timer);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok)
      throw classifyMetaError(response.status, payload, context);
    return (payload ?? {}) as GraphPayload;
  }

  return {
    async sendTemplate(args) {
      const payload = await request(
        args.token,
        `/${encodeURIComponent(args.phoneNumberId)}/messages`,
        { method: 'POST', body: buildTemplatePayload(args) },
        { templateName: args.templateName, templateLanguage: args.language },
      );
      const id = payload.messages?.[0]?.id;
      if (typeof id !== 'string' || !id)
        throw new WhatsAppApiError(
          'Meta respondió sin identificador de mensaje.',
          'meta_error',
          false,
        );
      return { messageId: id };
    },
    async getPhoneNumber(args) {
      const payload = await request(
        args.token,
        `/${encodeURIComponent(args.phoneNumberId)}?fields=display_phone_number,verified_name`,
        { method: 'GET' },
      );
      return {
        displayPhoneNumber:
          typeof payload.display_phone_number === 'string'
            ? payload.display_phone_number
            : null,
        verifiedName:
          typeof payload.verified_name === 'string'
            ? payload.verified_name
            : null,
      };
    },
    async getTemplate(args) {
      const payload = await request(
        args.token,
        `/${encodeURIComponent(args.wabaId)}/message_templates?name=${encodeURIComponent(args.name)}&fields=name,status,language&limit=50`,
        { method: 'GET' },
      );
      const match = (payload.data ?? []).find(
        (x) => x.name === args.name && x.language === args.language,
      );
      return { found: Boolean(match), status: match?.status ?? null };
    },
  };
}
