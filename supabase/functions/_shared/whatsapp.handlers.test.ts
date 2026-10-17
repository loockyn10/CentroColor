/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows and JSON bodies are untyped in tests. */
// WhatsApp integration end to end: real handlers → real stores → real migrations (PGlite).
// Only Meta's Graph API is a double (scripted responses), so the template payload, the error
// mapping, the secrecy of the token and the once-only guarantee are verified for real.
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from './http';
import { IDS, asRole } from './pg-harness';
import { orderFlow } from './pg-order-flow';
import { createWorld, type World } from './pg-world';
import { jsonRequest } from './test-support';
import {
  handleWhatsAppAdmin,
  handleWhatsAppDispatch,
  handleWhatsAppSend,
  handleWhatsAppWebhook,
  type WhatsAppAdminDeps,
} from './whatsapp-handlers';
import { WORLD_ENV, worldEnv } from './pg-world';

let w: World;
const { placeOrder, track } = orderFlow(() => w);
const TOKEN = 'EAAJ-super-secret-access-token-0123456789';

const USERS: Record<string, { id: string; business: string; role: string }> = {
  'jwt-owner': { id: IDS.owner, business: IDS.business, role: 'owner' },
  'jwt-staff': { id: IDS.staff, business: IDS.business, role: 'staff' },
  'jwt-outsider': {
    id: IDS.outsider,
    business: IDS.otherBusiness,
    role: 'owner',
  },
};
const authenticator =
  (adminOnly: boolean) => async (request: Request, businessId: string) => {
    const header = request.headers.get('Authorization');
    if (!header)
      throw new ApiError('Autorización requerida.', 401, 'unauthorized');
    const user = USERS[header.replace(/^Bearer /, '')];
    if (!user)
      throw new ApiError('Autorización inválida.', 401, 'unauthorized');
    if (user.business !== businessId)
      throw new ApiError('Se requiere rol owner o admin.', 403, 'forbidden');
    if (adminOnly && !['owner', 'admin'].includes(user.role))
      throw new ApiError('Se requiere rol owner o admin.', 403, 'forbidden');
    return { user: { id: user.id }, membership: { role: user.role } };
  };

const adminDeps = (): WhatsAppAdminDeps => ({
  authenticate: authenticator(true),
  services: () => ({ store: w.whatsapp, meta: w.metaClient }),
  getEnv: worldEnv,
  now: w.now,
  logger: w.logger,
});
const sendDeps = (): WhatsAppAdminDeps => ({
  ...adminDeps(),
  authenticate: authenticator(false),
});

const post = async (
  handler: (r: Request, d: any) => Promise<Response>,
  deps: unknown,
  body: unknown,
  jwt?: string,
  headers: Record<string, string> = {},
) => {
  const response = await handler(
    jsonRequest(body, {
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...headers,
    }),
    deps,
  );
  return { status: response.status, body: (await response.json()) as any };
};
const admin = (body: Record<string, unknown>, jwt = 'jwt-owner') =>
  post(
    handleWhatsAppAdmin,
    adminDeps(),
    { businessId: IDS.business, ...body },
    jwt,
  );
const operate = (body: Record<string, unknown>, jwt = 'jwt-staff') =>
  post(
    handleWhatsAppSend,
    sendDeps(),
    { businessId: IDS.business, ...body },
    jwt,
  );
const dispatch = (
  secret: string | null = WORLD_ENV.WHATSAPP_DISPATCH_SECRET!,
) =>
  post(
    handleWhatsAppDispatch,
    {
      services: adminDeps().services,
      getEnv: worldEnv,
      now: w.now,
      logger: w.logger,
    },
    {},
    undefined,
    secret ? { 'x-dispatch-secret': secret } : {},
  );

const configure = (overrides: Record<string, unknown> = {}) =>
  admin({
    action: 'configure',
    phoneNumberId: '109876543210',
    wabaId: '208765432101',
    templateName: 'pedido_listo',
    templateLanguage: 'es_AR',
    accessToken: TOKEN,
    ...overrides,
  });

const setStatus = (
  jobId: string,
  status: string,
  as: 'authenticated' | 'admin' = 'authenticated',
) =>
  as === 'admin'
    ? w.db.query(`update public.photo_jobs set status=$2 where id=$1`, [
        jobId,
        status,
      ])
    : asRole(w.db, 'authenticated', IDS.staff, () =>
        w.db.query(`update public.photo_jobs set status=$2 where id=$1`, [
          jobId,
          status,
        ]),
      );
const rows = async () =>
  (
    await w.db.query<any>(
      `select id, status, trigger_kind, last_error_code, provider_message_id, attempt_count from public.outbound_notifications order by created_at, id`,
    )
  ).rows;

beforeEach(async () => {
  w = await createWorld();
});

describe('configuración (owner/admin) — el token nunca sale', () => {
  it('guarda el token en Vault y devuelve sólo estado, número, plantilla e idioma', async () => {
    const result = await configure();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: 'configured',
      phoneNumberId: '109876543210',
      wabaId: '208765432101',
      templateName: 'pedido_listo',
      templateLanguage: 'es_AR',
    });
    const text = JSON.stringify(result.body);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toMatch(/secret|token/i);
    const stored = (
      await w.db.query<any>(`select * from public.whatsapp_integrations`)
    ).rows[0];
    expect(JSON.stringify(stored)).not.toContain(TOKEN);
    expect(
      (
        await w.db.query<any>(
          `select secret from vault.secrets where name like 'whatsapp_token_%'`,
        )
      ).rows,
    ).toEqual([{ secret: TOKEN }]);
    const logged = JSON.stringify(w.logger.mock.calls);
    expect(logged).not.toContain(TOKEN);
  });

  it('el estado de la integración no expone el token aunque se pida', async () => {
    await configure();
    const status = await admin({ action: 'status' });
    expect(JSON.stringify(status.body)).not.toContain(TOKEN);
    expect(status.body.status).toBe('configured');
    expect(
      (await admin({ action: 'status' }, 'jwt-owner')).body,
    ).not.toHaveProperty('accessToken');
  });

  it('cambiar plantilla o idioma sin reingresar el token conserva el guardado', async () => {
    await configure();
    const changed = await configure({
      accessToken: undefined,
      templateLanguage: 'es',
    });
    expect(changed.status).toBe(200);
    expect(changed.body.templateLanguage).toBe('es');
    expect(
      (
        await w.db.query<any>(
          `select count(*)::int n from vault.secrets where name like 'whatsapp_token_%'`,
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('rota el token: el secreto anterior se destruye', async () => {
    await configure();
    await configure({ accessToken: 'EAAJ-another-token-0123456789-new' });
    const secrets = (
      await w.db.query<any>(
        `select secret from vault.secrets where name like 'whatsapp_token_%'`,
      )
    ).rows;
    expect(secrets).toEqual([{ secret: 'EAAJ-another-token-0123456789-new' }]);
  });

  it('staff no puede configurar, probar ni desconectar; otro negocio tampoco', async () => {
    for (const action of ['configure', 'test', 'disconnect', 'status']) {
      expect((await admin({ action }, 'jwt-staff')).status, action).toBe(403);
      expect((await admin({ action }, 'jwt-outsider')).status, action).toBe(
        403,
      );
    }
    expect((await admin({ action: 'status' }, 'jwt-nope')).status).toBe(401);
    const anonymous = await post(handleWhatsAppAdmin, adminDeps(), {
      businessId: IDS.business,
      action: 'status',
    });
    expect(anonymous.status).toBe(401);
  });

  it.each([
    ['phone number id no numérico', { phoneNumberId: 'abc' }],
    ['waba id inválido', { wabaId: '12 3' }],
    ['plantilla con mayúsculas', { templateName: 'Pedido Listo' }],
    ['idioma inválido', { templateLanguage: 'español' }],
    [
      'token con espacios',
      { accessToken: 'EAAJ token con espacios 000000000' },
    ],
  ])('rechaza %s', async (_label, overrides) => {
    const result = await configure(overrides as Record<string, unknown>);
    expect(result.status).toBe(400);
    expect(
      (
        await w.db.query<any>(
          `select count(*)::int n from public.whatsapp_integrations`,
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('sin token previo ni nuevo no se puede configurar', async () => {
    const result = await configure({ accessToken: undefined });
    expect(result.status).toBe(422);
    expect(result.body.code).toBe('missing_access_token');
  });

  it('desconectar destruye el token y deja los pedidos funcionando', async () => {
    await configure();
    const result = await admin({ action: 'disconnect' });
    expect(result.body.status).toBe('disconnected');
    expect(
      (
        await w.db.query<any>(
          `select count(*)::int n from vault.secrets where name like 'whatsapp_token_%'`,
        )
      ).rows[0].n,
    ).toBe(0);
    const { jobId } = await placeOrder();
    await setStatus(jobId, 'ready');
    expect(
      (await w.db.query<any>(`select status from public.photo_jobs`)).rows[0]
        .status,
    ).toBe('ready');
  });
});

describe('probar conexión', () => {
  it('verifica el número y la plantilla aprobada', async () => {
    await configure();
    w.meta.reply({
      display_phone_number: '+54 9 342 555 1234',
      verified_name: 'CentroColor',
    });
    w.meta.reply({
      data: [{ name: 'pedido_listo', status: 'APPROVED', language: 'es_AR' }],
    });
    const result = await admin({ action: 'test' });
    expect(result.body).toMatchObject({
      ok: true,
      displayPhoneNumber: '+54 9 342 555 1234',
      template: { checked: true, found: true, status: 'APPROVED' },
    });
    expect(result.body.integration.displayPhoneNumber).toBe(
      '+54 9 342 555 1234',
    );
    expect(w.meta.calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(w.meta.calls[0]!.url).toContain('/109876543210?fields=');
    expect(JSON.stringify(result.body)).not.toContain(TOKEN);
  });

  it('informa una plantilla no aprobada o inexistente', async () => {
    await configure();
    w.meta.reply({ display_phone_number: '+54 9 342 555 1234' });
    w.meta.reply({
      data: [{ name: 'pedido_listo', status: 'PENDING', language: 'es_AR' }],
    });
    const pending = await admin({ action: 'test' });
    expect(pending.body).toMatchObject({
      ok: false,
      code: 'template_not_approved',
    });
    w.meta.reply({ display_phone_number: '+54 9 342 555 1234' });
    w.meta.reply({ data: [] });
    const missing = await admin({ action: 'test' });
    expect(missing.body).toMatchObject({
      ok: false,
      code: 'template_not_found',
    });
  });

  it('token inválido: mensaje útil, integración marcada en error, sin exponer el token', async () => {
    await configure();
    w.meta.reply(
      {
        error: {
          message: 'Invalid OAuth access token.',
          type: 'OAuthException',
          code: 190,
        },
      },
      401,
    );
    const result = await admin({ action: 'test' });
    expect(result.body).toMatchObject({ ok: false, code: 'token_invalid' });
    expect(result.body.message).toMatch(/inválido o venció/);
    expect(result.body.integration.status).toBe('error');
    expect(JSON.stringify(result.body)).not.toContain(TOKEN);
  });
});

describe('ready → aviso automático por WhatsApp', () => {
  async function readyJob(optIn = true) {
    await configure();
    const order = await placeOrder({ whatsappOptIn: optIn });
    await setStatus(order.jobId, 'in_progress');
    await setStatus(order.jobId, 'ready');
    return order;
  }

  it('manda la plantilla de utilidad con nombre, código y link de seguimiento; guarda el id de Meta como sent', async () => {
    const { jobId } = await readyJob();
    const result = await dispatch();
    expect(result.body).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(w.meta.calls).toHaveLength(1);
    const call = w.meta.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe(
      'https://graph.facebook.com/v22.0/109876543210/messages',
    );
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '5493425551234',
      type: 'template',
      template: { name: 'pedido_listo', language: { code: 'es_AR' } },
    });
    const parameters = call.body.template.components[0].parameters;
    expect(parameters.map((p: any) => p.type)).toEqual([
      'text',
      'text',
      'text',
    ]);
    expect(parameters[0].text).toBe('María');
    expect(parameters[1].text).toBe(`CC-${jobId.slice(0, 8).toUpperCase()}`);
    expect(parameters[2].text).toMatch(
      /^https:\/\/centro-color-web\.vercel\.app\/pedido\/[A-Za-z0-9_-]{43}$/,
    );
    expect(JSON.stringify(call.body)).not.toContain(TOKEN);
    expect(await rows()).toEqual([
      expect.objectContaining({
        status: 'sent',
        provider_message_id: 'wamid.1',
        attempt_count: 1,
      }),
    ]);
  });

  it('el link del mensaje funciona para consultar el estado y es sólo de seguimiento', async () => {
    const { jobId } = await readyJob();
    await dispatch();
    const url = w.meta.calls[0]!.body.template.components[0].parameters[2]
      .text as string;
    const token = url.split('/pedido/')[1]!;
    const tracked = await track(token);
    expect(tracked.status).toBe(200);
    expect(tracked.body.status).toBe('ready');
    expect(tracked.body.orderCode).toBe(
      `CC-${jobId.slice(0, 8).toUpperCase()}`,
    );
    // El mensaje no revela token de subida ni el UUID del trabajo.
    expect(JSON.stringify(w.meta.calls[0]!.body)).not.toContain(jobId);
  });

  it('despachar dos veces o en paralelo manda UN solo mensaje', async () => {
    await readyJob();
    await Promise.all([dispatch(), dispatch(), dispatch()]);
    await dispatch();
    expect(w.meta.calls).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it('ready → in_progress → ready no genera ni manda un segundo aviso automático', async () => {
    const { jobId } = await readyJob();
    await dispatch();
    await setStatus(jobId, 'in_progress');
    await setStatus(jobId, 'ready');
    await dispatch();
    expect(w.meta.calls).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it('sin consentimiento no se envía nada', async () => {
    await readyJob(false);
    const result = await dispatch();
    expect(result.body.processed).toBe(0);
    expect(w.meta.calls).toHaveLength(0);
    expect(await rows()).toEqual([]);
  });

  it('sin integración el trabajo queda listo igual y el aviso queda failed y reintentable', async () => {
    const order = await placeOrder();
    await setStatus(order.jobId, 'ready');
    expect(
      (await w.db.query<any>(`select status from public.photo_jobs`)).rows[0]
        .status,
    ).toBe('ready');
    expect(await rows()).toEqual([
      expect.objectContaining({
        status: 'failed',
        last_error_code: 'integration_not_configured',
      }),
    ]);
    expect((await dispatch()).body.processed).toBe(0);
    // Después de configurar, el equipo puede reintentar con un clic.
    await configure();
    const id = (await rows())[0].id as string;
    const retry = await operate({ action: 'retry', notificationId: id });
    expect(retry.status).toBe(200);
    expect(retry.body.notifications[0]).toMatchObject({ status: 'sent' });
    expect(w.meta.calls).toHaveLength(1);
  });

  it('un cambio hecho por SQL administrativo o por un miembro dispara el mismo único aviso', async () => {
    await configure();
    const order = await placeOrder();
    await setStatus(order.jobId, 'ready', 'admin');
    await dispatch();
    await setStatus(order.jobId, 'in_progress');
    await setStatus(order.jobId, 'ready');
    await dispatch();
    expect(w.meta.calls).toHaveLength(1);
  });
});

describe('errores de Meta: el trabajo no se bloquea, el aviso queda failed con un mensaje útil', () => {
  async function failWith(status: number, body: unknown) {
    await configure();
    const order = await placeOrder();
    w.meta.reply(body, status);
    await setStatus(order.jobId, 'ready');
    await dispatch();
    return { order, row: (await rows())[0]! };
  }

  it.each([
    [
      'token inválido',
      401,
      {
        error: {
          message: 'Invalid OAuth access token',
          type: 'OAuthException',
          code: 190,
        },
      },
      'token_invalid',
    ],
    [
      'plantilla inexistente',
      404,
      {
        error: {
          message: 'Template name does not exist in the translation',
          code: 132001,
        },
      },
      'template_not_found',
    ],
    [
      'plantilla pausada',
      400,
      { error: { message: 'Template paused', code: 132015 } },
      'template_unavailable',
    ],
    [
      'parámetros incorrectos',
      400,
      {
        error: { message: 'number of parameters does not match', code: 132000 },
      },
      'template_params_mismatch',
    ],
    [
      'destinatario no permitido',
      400,
      {
        error: {
          message: 'Recipient phone number not in allowed list',
          code: 131030,
        },
      },
      'recipient_not_allowed',
    ],
    [
      'número sin WhatsApp',
      400,
      { error: { message: 'Message undeliverable', code: 131026 } },
      'recipient_unreachable',
    ],
    [
      'rate limit',
      429,
      { error: { message: 'Too many messages', code: 130429 } },
      'rate_limited',
    ],
    [
      'Meta caído',
      503,
      { error: { message: 'Service unavailable', code: 2 } },
      'meta_unavailable',
    ],
    [
      'phone number id inexistente',
      400,
      {
        error: {
          message: 'Unsupported post request. Object with ID does not exist',
          code: 100,
          error_subcode: 33,
        },
      },
      'phone_number_not_found',
    ],
    [
      'rechazo genérico',
      400,
      { error: { message: 'Something odd', code: 999 } },
      'meta_error',
    ],
  ])('%s', async (_label, status, body, code) => {
    const { order, row } = await failWith(status as number, body);
    expect(row).toMatchObject({ status: 'failed', last_error_code: code });
    expect(
      (
        await w.db.query<any>(
          `select status from public.photo_jobs where id=$1`,
          [order.jobId],
        )
      ).rows[0].status,
    ).toBe('ready');
    const message = (
      await w.db.query<any>(
        `select last_error from public.outbound_notifications`,
      )
    ).rows[0].last_error as string;
    expect(message.length).toBeGreaterThan(10);
    expect(message).not.toContain(TOKEN);
  });

  it('token inválido pone la integración en error y los próximos avisos lo dicen', async () => {
    await failWith(401, {
      error: {
        message: 'Invalid OAuth access token',
        type: 'OAuthException',
        code: 190,
      },
    });
    expect((await admin({ action: 'status' })).body.status).toBe('error');
    const second = await placeOrder({
      clientKey: 'client-key-bbbbbbbbbbbb',
      customer: { name: 'Ana', phone: '351 555 1111' },
    });
    await setStatus(second.jobId, 'ready');
    const latest = (await rows()).at(-1)!;
    expect(latest).toMatchObject({
      status: 'failed',
      last_error_code: 'integration_error',
    });
  });

  it.each([
    ['sin red', new TypeError('fetch failed'), 'network_error'],
    [
      'timeout',
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
      'timeout',
    ],
  ])('%s', async (_label, cause, code) => {
    await configure();
    const order = await placeOrder();
    w.meta.fail(cause as Error);
    await setStatus(order.jobId, 'ready');
    await dispatch();
    expect((await rows())[0]).toMatchObject({
      status: 'failed',
      last_error_code: code,
    });
  });

  it('reintentar tras un fallo transitorio envía una sola vez más y deja auditoría', async () => {
    const { row } = await failWith(503, {
      error: { message: 'down', code: 2 },
    });
    const retry = await operate({ action: 'retry', notificationId: row.id });
    expect(retry.status).toBe(200);
    expect(retry.body.notifications[0]).toMatchObject({
      status: 'sent',
      attemptCount: 2,
    });
    expect(w.meta.calls).toHaveLength(2);
    expect(await rows()).toHaveLength(1);
    const events = (
      await w.db.query<any>(
        `select kind, actor_id from public.outbound_notification_events order by id`,
      )
    ).rows;
    expect(events.map((x) => x.kind)).toEqual([
      'queued',
      'attempt',
      'failed',
      'retry_requested',
      'attempt',
      'sent',
    ]);
    expect(events[3].actor_id).toBe(IDS.staff);
    // Ya enviado: no se puede reintentar de nuevo.
    expect(
      (await operate({ action: 'retry', notificationId: row.id })).status,
    ).toBe(409);
  });
});

describe('reenvío manual', () => {
  it('crea una notificación nueva y auditada sin romper la idempotencia del aviso automático', async () => {
    await configure();
    const order = await placeOrder();
    await setStatus(order.jobId, 'ready');
    await dispatch();
    const resend = await operate({ action: 'resend', photoJobId: order.jobId });
    expect(resend.status).toBe(200);
    expect(resend.body.notifications[0]).toMatchObject({
      status: 'sent',
      triggerKind: 'manual_resend',
    });
    expect(w.meta.calls).toHaveLength(2);
    const all = await rows();
    expect(all.map((x) => x.trigger_kind)).toEqual(['auto', 'manual_resend']);
    // Volver a ready no genera otra automática.
    await setStatus(order.jobId, 'in_progress');
    await setStatus(order.jobId, 'ready');
    await dispatch();
    expect(w.meta.calls).toHaveLength(2);
    expect(
      (await rows()).filter((x) => x.trigger_kind === 'auto'),
    ).toHaveLength(1);
  });

  it('no reenvía si el trabajo no está listo, sin aviso previo o sin consentimiento; limita los reenvíos', async () => {
    await configure();
    const order = await placeOrder();
    expect(
      (await operate({ action: 'resend', photoJobId: order.jobId })).body.code,
    ).toBe('job_not_ready');
    await setStatus(order.jobId, 'ready');
    await dispatch();
    for (let i = 0; i < 5; i += 1)
      expect(
        (await operate({ action: 'resend', photoJobId: order.jobId })).status,
      ).toBe(200);
    const limited = await operate({
      action: 'resend',
      photoJobId: order.jobId,
    });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('resend_limit');

    const noConsent = await placeOrder({
      clientKey: 'client-key-bbbbbbbbbbbb',
      customer: { name: 'Ana', phone: '351 555 1111' },
      whatsappOptIn: false,
    });
    await setStatus(noConsent.jobId, 'ready');
    expect(
      (await operate({ action: 'resend', photoJobId: noConsent.jobId })).body
        .code,
    ).toBe('no_consent');
  });

  it('otro negocio no puede operar los avisos', async () => {
    await configure();
    const order = await placeOrder();
    await setStatus(order.jobId, 'ready');
    const id = (await rows())[0].id as string;
    const foreign = await post(
      handleWhatsAppSend,
      sendDeps(),
      { businessId: IDS.business, action: 'retry', notificationId: id },
      'jwt-outsider',
    );
    expect(foreign.status).toBe(403);
    const crossTenant = await post(
      handleWhatsAppSend,
      sendDeps(),
      { businessId: IDS.otherBusiness, action: 'retry', notificationId: id },
      'jwt-outsider',
    );
    expect(crossTenant.status).toBe(409);
  });

  it('process despacha los avisos pendientes de un trabajo (wake-up desde la Web)', async () => {
    await configure();
    const order = await placeOrder();
    await setStatus(order.jobId, 'ready');
    const result = await operate({
      action: 'process',
      photoJobId: order.jobId,
    });
    expect(result.status).toBe(200);
    expect(result.body.notifications[0]).toMatchObject({ status: 'sent' });
    expect(w.meta.calls).toHaveLength(1);
  });
});

describe('dispatcher y webhook', () => {
  it('el dispatcher exige el secreto compartido', async () => {
    expect((await dispatch(null)).status).toBe(401);
    expect((await dispatch('wrong-secret-0123456789abcdef')).status).toBe(401);
    expect((await dispatch('')).status).toBe(401);
  });

  it('sin WHATSAPP_DISPATCH_SECRET configurado el dispatcher rechaza todo', async () => {
    const result = await post(
      handleWhatsAppDispatch,
      {
        services: adminDeps().services,
        getEnv: (n: string) =>
          n === 'WHATSAPP_DISPATCH_SECRET' ? undefined : worldEnv(n),
        logger: w.logger,
      },
      {},
      undefined,
      { 'x-dispatch-secret': 'anything-anything-anything-123' },
    );
    expect(result.status).toBe(500);
    expect(result.body.error).toContain('WHATSAPP_DISPATCH_SECRET');
  });

  const sign = async (
    payload: string,
    secret = WORLD_ENV.WHATSAPP_APP_SECRET!,
  ) => {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(payload),
    );
    return `sha256=${Array.from(new Uint8Array(mac), (x) => x.toString(16).padStart(2, '0')).join('')}`;
  };
  const webhook = async (payload: object, signature?: string) => {
    const raw = JSON.stringify(payload);
    const response = await handleWhatsAppWebhook(
      new Request('https://p.supabase.co/functions/v1/whatsapp-webhook', {
        method: 'POST',
        headers: {
          'x-hub-signature-256': signature ?? (await sign(raw)),
          'Content-Type': 'application/json',
        },
        body: raw,
      }),
      { store: () => w.whatsapp, getEnv: worldEnv, logger: w.logger },
    );
    return { status: response.status, body: await response.json() };
  };
  const statusEvent = (id: string, status: string, extra: object = {}) => ({
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [{ id, status, timestamp: '1760800000', ...extra }],
            },
          },
        ],
      },
    ],
  });

  async function sentJob() {
    await configure();
    const order = await placeOrder();
    await setStatus(order.jobId, 'ready');
    await dispatch();
    return order;
  }

  it('verifica el webhook con el token de verificación', async () => {
    const url = (token: string) =>
      `https://p.supabase.co/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345`;
    const deps = {
      store: () => w.whatsapp,
      getEnv: worldEnv,
      logger: w.logger,
    };
    const ok = await handleWhatsAppWebhook(
      new Request(url(WORLD_ENV.WHATSAPP_WEBHOOK_VERIFY_TOKEN!)),
      deps,
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('12345');
    expect(
      (await handleWhatsAppWebhook(new Request(url('nope')), deps)).status,
    ).toBe(403);
  });

  it('rechaza firmas inválidas o ausentes y no cambia nada', async () => {
    await sentJob();
    const payload = statusEvent('wamid.1', 'delivered');
    expect((await webhook(payload, 'sha256=deadbeef')).status).toBe(401);
    expect(
      (
        await webhook(
          payload,
          await sign(JSON.stringify(payload), 'otro-secreto'),
        )
      ).status,
    ).toBe(401);
    expect((await rows())[0]!.status).toBe('sent');
  });

  it('delivered y read sólo se registran cuando Meta los informa; antes queda sent', async () => {
    await sentJob();
    expect((await rows())[0]!.status).toBe('sent');
    expect((await webhook(statusEvent('wamid.1', 'delivered'))).body).toEqual({
      ok: true,
      applied: 1,
    });
    expect((await rows())[0]!.status).toBe('delivered');
    await webhook(statusEvent('wamid.1', 'read'));
    expect((await rows())[0]!.status).toBe('read');
    expect(
      (await webhook(statusEvent('wamid.1', 'delivered'))).body.applied,
    ).toBe(0);
    expect((await rows())[0]!.status).toBe('read');
  });

  it('un failed del webhook marca el aviso y conserva el código de Meta', async () => {
    await sentJob();
    await webhook(
      statusEvent('wamid.1', 'failed', {
        errors: [{ code: 131026, title: 'Message undeliverable' }],
      }),
    );
    expect((await rows())[0]).toMatchObject({
      status: 'failed',
      last_error_code: '131026',
    });
  });

  it('ignora ids desconocidos y estados no soportados sin fallar', async () => {
    await sentJob();
    const result = await webhook(statusEvent('wamid.desconocido', 'delivered'));
    expect(result.status).toBe(200);
    expect(result.body.applied).toBe(0);
    expect((await webhook(statusEvent('wamid.1', 'sent'))).body.applied).toBe(
      0,
    );
  });
});
