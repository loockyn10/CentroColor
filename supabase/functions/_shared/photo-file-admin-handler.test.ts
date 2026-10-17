import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';
import {
  handlePhotoFileAdmin,
  type AdminDeps,
} from './photo-file-admin-handler';
import {
  BUSINESS_A,
  ENV,
  JOB_A,
  JOB_B,
  JOB_NO_FILES,
  createFakeDrive,
  createFakeStore,
  defaultUsers,
  fakeAuthenticator,
  getEnv,
  jsonRequest,
  seedState,
  type FakeDriveOptions,
} from './test-support';
import { sha256 } from './token';

function setup(
  options: {
    drive?: FakeDriveOptions;
    env?: Record<string, string | undefined>;
  } = {},
) {
  const state = seedState();
  const store = createFakeStore(state);
  const { drive, record } = createFakeDrive(store, state, options.drive);
  const services = vi.fn(() => ({ store, drive }));
  const logger = vi.fn();
  const deps: AdminDeps = {
    authenticate: fakeAuthenticator(defaultUsers),
    services,
    getEnv: options.env ? (name) => ({ ...ENV, ...options.env })[name] : getEnv,
    now: () => Date.parse('2026-10-17T12:00:00Z'),
    logger,
  };
  const call = (
    body: unknown,
    jwt: string | null = 'jwt-owner',
    method = 'POST',
  ) =>
    handlePhotoFileAdmin(
      jsonRequest(body, jwt ? { Authorization: `Bearer ${jwt}` } : {}, method),
      deps,
    );
  return { state, store, record, services, logger, call };
}

const createLink = (businessId = BUSINESS_A, photoJobId = JOB_A) => ({
  action: 'create_link',
  businessId,
  photoJobId,
});

describe('photo-file-admin — generar link', () => {
  it.each(['jwt-owner', 'jwt-admin'])(
    '%s genera un link con URL pública válida y guarda sólo el hash',
    async (jwt) => {
      const { call, state } = setup();
      const response = await call(createLink(), jwt);
      expect(response.status).toBe(200);
      const body = await response.json();
      const url = new URL(body.url);
      expect(url.origin).toBe('https://centro-color-web.vercel.app');
      const token = url.pathname.replace('/enviar/', '');
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(state.links).toHaveLength(1);
      const stored = state.links[0]!;
      expect(stored.token_hash).toBe(await sha256(token));
      expect(JSON.stringify(state.links)).not.toContain(token);
      expect(body).toMatchObject({
        id: stored.id,
        revoked_at: null,
        submitted_at: null,
      });
      expect(body).not.toHaveProperty('token_hash');
    },
  );

  it('expira según PHOTO_UPLOAD_LINK_DAYS', async () => {
    const { call } = setup({ env: { PHOTO_UPLOAD_LINK_DAYS: '3' } });
    const body = await (await call(createLink())).json();
    expect(Date.parse(body.expires_at)).toBe(
      Date.parse('2026-10-20T12:00:00Z'),
    );
  });

  it('pasa el job a awaiting_files y no usa servicios hasta autorizar', async () => {
    const { call, state } = setup();
    await call(createLink());
    expect(state.jobs.find((x) => x.id === JOB_A)?.file_intake_status).toBe(
      'awaiting_files',
    );
  });

  it('staff es rechazado con 403 sin crear servicios service-role ni tocar datos', async () => {
    const { call, services, state } = setup();
    const response = await call(createLink(), 'jwt-staff');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Se requiere rol owner o admin.',
    });
    expect(services).not.toHaveBeenCalled();
    expect(state.links).toHaveLength(0);
    expect(state.calls).toHaveLength(0);
  });

  it('sin JWT o con JWT inválido responde 401', async () => {
    const { call, services } = setup();
    expect((await call(createLink(), null)).status).toBe(401);
    expect((await call(createLink(), 'jwt-desconocido')).status).toBe(401);
    expect(services).not.toHaveBeenCalled();
  });

  it('un owner de otro Business no puede operar sobre este (403)', async () => {
    const { call, state } = setup();
    const response = await call(createLink(BUSINESS_A, JOB_A), 'jwt-owner-b');
    expect(response.status).toBe(403);
    expect(state.links).toHaveLength(0);
  });

  it('Job de otro Business -> 404 aunque el usuario sea owner del suyo', async () => {
    const { call, state } = setup();
    const response = await call(createLink(BUSINESS_A, JOB_B));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'job_not_found',
    });
    expect(state.links).toHaveLength(0);
  });

  it('Job inexistente -> 404', async () => {
    const { call } = setup();
    const response = await call(
      createLink(BUSINESS_A, '99999999-9999-4999-8999-999999999999'),
    );
    expect(response.status).toBe(404);
  });

  it('Drive desconectado -> 409 con mensaje accionable y sin crear link', async () => {
    const { call, state } = setup({
      drive: {
        accessError: new ApiError(
          'Google Drive no está conectado.',
          409,
          'drive_not_connected',
        ),
      },
    });
    const response = await call(createLink());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Google Drive no está conectado.',
      code: 'drive_not_connected',
    });
    expect(state.links).toHaveLength(0);
    expect(state.jobs.find((x) => x.id === JOB_A)?.file_intake_status).toBe(
      'not_requested',
    );
  });

  it('un Job sin servicios que reciban archivos -> 422', async () => {
    const { call } = setup();
    const response = await call(createLink(BUSINESS_A, JOB_NO_FILES));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'no_uploadable_items',
    });
  });

  it('un Job entregado o cancelado no genera link (409)', async () => {
    const { call, state } = setup();
    state.jobs.find((x) => x.id === JOB_A)!.status = 'delivered';
    expect((await call(createLink())).status).toBe(409);
  });

  it('regenerar revoca el link anterior y conserva uno solo activo', async () => {
    const { call, state } = setup();
    const first = await (await call(createLink())).json();
    const second = await (await call(createLink())).json();
    expect(first.id).not.toBe(second.id);
    expect(state.links.find((x) => x.id === first.id)?.revoked_at).toBeTruthy();
    expect(state.links.find((x) => x.id === second.id)?.revoked_at).toBeNull();
    expect(state.links.filter((x) => !x.revoked_at)).toHaveLength(1);
  });

  it('un insert fallido no revoca el link vigente', async () => {
    const { call, state } = setup();
    const first = await (await call(createLink())).json();
    state.failures.add('photo_job_upload_links.insert');
    const response = await call(createLink());
    expect(response.status).toBe(500);
    expect(state.links.find((x) => x.id === first.id)?.revoked_at).toBeNull();
  });

  it('un error de base de datos no se esconde: log server-side, mensaje genérico y requestId', async () => {
    // Reproduce el fallo real de producción: service_role sin grants (42501).
    const { call, state, logger } = setup();
    state.failures.add('photo_job_upload_links.insert');
    const response = await call(createLink());
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      code: 'database_error',
      error: 'No se pudo completar la operación.',
    });
    expect(body.requestId).toEqual(expect.any(String));
    expect(logger).toHaveBeenCalledWith(
      'error',
      'photo_file_admin_database_error',
      expect.objectContaining({
        operation: 'photo_job_upload_links.insert',
        databaseError: expect.objectContaining({ code: '42501' }),
      }),
    );
  });

  it('configuración faltante o inválida -> 500 que nombra la variable, sin valores', async () => {
    const { call, state } = setup({
      env: { PHOTO_UPLOAD_SIGNING_SECRET: undefined },
    });
    const response = await call(createLink());
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.code).toBe('server_misconfigured');
    expect(body.error).toContain('PHOTO_UPLOAD_SIGNING_SECRET');
    expect(state.links).toHaveLength(0);
    const invalid = setup({ env: { PHOTO_UPLOAD_MAX_BYTES: '2GB' } });
    expect((await (await invalid.call(createLink())).json()).error).toContain(
      'PHOTO_UPLOAD_MAX_BYTES',
    );
  });

  it('valida el payload (contrato) antes de tocar nada', async () => {
    const { call, services } = setup();
    const noJob = await call({ action: 'create_link', businessId: BUSINESS_A });
    expect(noJob.status).toBe(400);
    const wrongKey = await call({
      action: 'create_link',
      businessId: BUSINESS_A,
      jobId: JOB_A,
    });
    expect(wrongKey.status).toBe(400);
    expect(
      (await call({ action: 'explode', businessId: BUSINESS_A })).status,
    ).toBe(400);
    expect((await call({ action: 'status', businessId: 'x' })).status).toBe(
      400,
    );
    expect(services).not.toHaveBeenCalled();
  });

  it('OPTIONS responde CORS y otros métodos son rechazados', async () => {
    const { call } = setup();
    expect((await call({}, null, 'OPTIONS')).status).toBe(200);
  });
});

describe('photo-file-admin — revocar, consultar y estado', () => {
  it('revoke_link revoca los links activos del Job', async () => {
    const { call, state } = setup();
    await call(createLink());
    const response = await call({
      action: 'revoke_link',
      businessId: BUSINESS_A,
      photoJobId: JOB_A,
    });
    expect(response.status).toBe(200);
    expect(state.links.every((x) => x.revoked_at)).toBe(true);
  });

  it('revoke_link de un Job ajeno no toca nada (404)', async () => {
    const { call, state } = setup();
    await call(createLink());
    const response = await call({
      action: 'revoke_link',
      businessId: BUSINESS_A,
      photoJobId: JOB_B,
    });
    expect(response.status).toBe(404);
    expect(state.links.some((x) => x.revoked_at)).toBe(false);
  });

  it('get_link devuelve el último link sin token y null si no hay', async () => {
    const { call } = setup();
    const empty = await call({
      action: 'get_link',
      businessId: BUSINESS_A,
      photoJobId: JOB_A,
    });
    await expect(empty.json()).resolves.toBeNull();
    await call(createLink());
    const body = await (
      await call({
        action: 'get_link',
        businessId: BUSINESS_A,
        photoJobId: JOB_A,
      })
    ).json();
    expect(body.url).toBeNull();
    expect(body).not.toHaveProperty('token_hash');
  });

  it('status refleja la integración y es la forma que consume la UI', async () => {
    const { call, state } = setup();
    const connected = await (
      await call({ action: 'status', businessId: BUSINESS_A })
    ).json();
    expect(connected).toEqual({
      status: 'connected',
      google_account_email: 'owner@example.com',
      root_folder_id: expect.any(String),
      connected_at: expect.any(String),
    });
    state.integrations = [];
    const none = await (
      await call({ action: 'status', businessId: BUSINESS_A })
    ).json();
    expect(none.status).toBe('disconnected');
  });

  it('disconnect borra el secreto de Vault y marca la integración', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    const state = seedState();
    const store = createFakeStore(state);
    const { drive } = createFakeDrive(store, state);
    const response = await handlePhotoFileAdmin(
      jsonRequest(
        { action: 'disconnect', businessId: BUSINESS_A },
        { Authorization: 'Bearer jwt-admin' },
      ),
      {
        authenticate: fakeAuthenticator(defaultUsers),
        services: () => ({ store, drive }),
        getEnv,
        fetcher,
      },
    );
    expect(response.status).toBe(200);
    expect(
      state.integrations.find((x) => x.business_id === BUSINESS_A)?.status,
    ).toBe('disconnected');
    expect(state.refreshTokens.has(`secret-${BUSINESS_A.slice(0, 4)}`)).toBe(
      false,
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('revoke');
  });

  it('staff tampoco puede consultar el estado de Drive', async () => {
    const { call } = setup();
    expect(
      (await call({ action: 'status', businessId: BUSINESS_A }, 'jwt-staff'))
        .status,
    ).toBe(403);
  });
});
