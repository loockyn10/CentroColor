import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';
import { destinationId, randomToken, sha256 } from './token';
import {
  buildManifest,
  handleUploadContext,
  handleUploadFinalize,
  handleUploadSession,
  handleUploadSubmit,
  type PublicDeps,
} from './upload-handlers';
import {
  BUSINESS_A,
  ENV,
  ITEM_EDIT,
  ITEM_LAB,
  ITEM_PLAIN,
  JOB_A,
  JOB_B,
  createFakeDrive,
  createFakeStore,
  getEnv,
  jsonRequest,
  seedState,
  type FakeDriveOptions,
  type StoreState,
} from './test-support';

const NOW = Date.parse('2026-10-17T12:00:00Z');

function setup(drive: FakeDriveOptions = {}) {
  const state = seedState();
  const store = createFakeStore(state);
  const fake = createFakeDrive(store, state, drive);
  const logger = vi.fn();
  const deps: PublicDeps = {
    store,
    drive: fake.drive,
    getEnv,
    now: () => NOW,
    logger,
  };
  return { state, store, record: fake.record, logger, deps };
}

async function issueLink(
  state: StoreState,
  overrides: Partial<{
    jobId: string;
    businessId: string;
    expires: string | null;
    revoked: string | null;
    submitted: string | null;
  }> = {},
) {
  const token = randomToken(32);
  state.links.push({
    id: `link-${state.links.length + 1}`,
    business_id: overrides.businessId ?? BUSINESS_A,
    photo_job_id: overrides.jobId ?? JOB_A,
    purpose: 'upload',
    token_hash: await sha256(token),
    created_by: 'user-owner',
    expires_at:
      overrides.expires === undefined
        ? '2026-10-31T12:00:00Z'
        : overrides.expires,
    revoked_at: overrides.revoked ?? null,
    submitted_at: overrides.submitted ?? null,
    created_at: '2026-10-17T00:00:00Z',
  });
  return { token, link: state.links.at(-1)! };
}

const post = (
  handler: (r: Request, d: PublicDeps) => Promise<Response>,
  deps: PublicDeps,
  body: unknown,
  headers: Record<string, string> = {},
) => handler(jsonRequest(body, headers), deps);

const labDestination = (linkId: string) =>
  destinationId(ENV.PHOTO_UPLOAD_SIGNING_SECRET!, linkId, ITEM_LAB);
const editDestination = (linkId: string) =>
  destinationId(ENV.PHOTO_UPLOAD_SIGNING_SECRET!, linkId, ITEM_EDIT);

const photo = (name = 'IMG_0001.jpg', size = 1024) => ({
  filename: name,
  mimeType: 'image/jpeg',
  sizeBytes: size,
});

describe('portal público — photo-upload-context', () => {
  it('funciona sin sesión y devuelve sólo datos mínimos de destinos válidos', async () => {
    const { deps, state } = setup();
    const { token, link } = await issueLink(state);
    const response = await post(handleUploadContext, deps, { token });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      businessName: 'CentroColor',
      customerName: 'María',
      orderCode: 'CC-AAAAAAAA',
      expiresAt: '2026-10-31T12:00:00Z',
      destinations: [
        {
          destinationId: await labDestination(link.id),
          name: 'Foto 10x15',
          quantity: 4,
          widthMm: 100,
          heightMm: 150,
          workflowRoute: 'lab',
        },
        {
          destinationId: await editDestination(link.id),
          name: 'Restauración',
          quantity: 1,
          widthMm: null,
          heightMm: null,
          workflowRoute: 'editing',
        },
      ],
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain(ITEM_LAB);
    expect(text).not.toContain(ITEM_PLAIN);
    expect(text).not.toContain(BUSINESS_A);
    expect(text).not.toContain('García');
  });

  it.each([
    ['inexistente', undefined, 404, 'link_invalid'],
    ['expirado', { expires: '2026-10-01T00:00:00Z' }, 410, 'link_expired'],
    ['revocado', { revoked: '2026-10-02T00:00:00Z' }, 410, 'link_revoked'],
    ['enviado', { submitted: '2026-10-03T00:00:00Z' }, 409, 'link_submitted'],
  ])('rechaza un link %s', async (_name, overrides, status, code) => {
    const { deps, state } = setup();
    const issued = await issueLink(state, overrides);
    const token = overrides ? issued.token : randomToken(32);
    const response = await post(handleUploadContext, deps, { token });
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code });
  });

  it('rechaza tokens con formato inválido sin consultar la base', async () => {
    const { deps, state } = setup();
    for (const token of [
      undefined,
      '',
      'corto',
      'x'.repeat(200),
      'a b'.repeat(20),
    ])
      expect((await post(handleUploadContext, deps, { token })).status).toBe(
        404,
      );
    expect(state.calls).toHaveLength(0);
  });

  it('un pedido entregado o cancelado ya no acepta archivos', async () => {
    const { deps, state } = setup();
    const { token } = await issueLink(state);
    state.jobs.find((x) => x.id === JOB_A)!.status = 'cancelled';
    expect((await post(handleUploadContext, deps, { token })).status).toBe(410);
  });

  it('una configuración inválida nunca se filtra al público', async () => {
    const { deps, state } = setup();
    const { token } = await issueLink(state);
    const broken = { ...deps, getEnv: () => undefined };
    const response = await post(handleUploadContext, broken, { token });
    expect(response.status).toBe(503);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain('PHOTO_UPLOAD');
  });

  it('el token de un Job sólo expone ese Job', async () => {
    const { deps, state } = setup();
    const { token } = await issueLink(state, {
      jobId: JOB_B,
      businessId: '22222222-2222-4222-8222-222222222222',
    });
    const body = await (
      await post(handleUploadContext, deps, { token })
    ).json();
    expect(body.orderCode).toBe('CC-BBBBBBBB');
    expect(body.destinations).toHaveLength(1);
    expect(body.destinations[0].name).toBe('Foto 13x18');
  });
});

describe('portal público — photo-upload-session', () => {
  async function session(
    overrides: Record<string, unknown> = {},
    options: {
      drive?: FakeDriveOptions;
      headers?: Record<string, string>;
    } = {},
  ) {
    const ctx = setup(options.drive);
    const { token, link } = await issueLink(ctx.state);
    const response = await post(
      handleUploadSession,
      ctx.deps,
      {
        token,
        destinationId: await labDestination(link.id),
        ...photo(),
        copies: 3,
        ...overrides,
      },
      options.headers,
    );
    return { ...ctx, token, link, response };
  }

  it('crea la sesión resumible, registra metadata pending→uploading y marca receiving', async () => {
    const { response, state, record, link } = await session();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      uploadUrl: expect.stringContaining('upload_id='),
      chunkSize: 8 * 1024 * 1024,
    });
    expect(body.chunkSize % (256 * 1024)).toBe(0);
    const file = state.files[0]!;
    expect(file).toMatchObject({
      id: body.uploadId,
      photo_job_id: JOB_A,
      photo_job_item_id: ITEM_LAB,
      status: 'uploading',
      copies: 3,
      workflow_route: 'lab',
      original_filename: 'IMG_0001.jpg',
      size_bytes: 1024,
    });
    expect(file.stored_filename).toMatch(/^[0-9a-f]{8}-IMG_0001\.jpg$/);
    expect(state.jobs.find((x) => x.id === JOB_A)?.file_intake_status).toBe(
      'receiving',
    );
    expect(record.sessions[0]?.metadata).toMatchObject({
      id: file.drive_file_id,
      name: file.stored_filename,
      parents: [file.drive_folder_id],
    });
    expect(link.id).toBeTruthy();
  });

  it('las appProperties respetan el límite de 124 bytes por propiedad de Drive', async () => {
    const longName = `${'ñ'.repeat(100)}.jpg`;
    const { record } = await session({ filename: longName });
    const props = (record.sessions[0]!.metadata.appProperties ?? {}) as Record<
      string,
      string
    >;
    for (const [key, value] of Object.entries(props))
      expect(
        new TextEncoder().encode(key + value).length,
        `${key} excede el límite`,
      ).toBeLessThanOrEqual(124);
    expect(Object.keys(props)).not.toContain('original_filename');
  });

  it('reenvía el Origin del navegador para habilitar CORS en el PUT a Drive', async () => {
    const { record } = await session(
      {},
      { headers: { Origin: 'https://centro-color-web.vercel.app' } },
    );
    expect(record.sessions[0]?.origin).toBe(
      'https://centro-color-web.vercel.app',
    );
    const noOrigin = await session();
    expect(noOrigin.record.sessions[0]?.origin).toBe(
      'https://centro-color-web.vercel.app',
    );
    const hostile = await session(
      {},
      { headers: { Origin: 'javascript:alert(1)' } },
    );
    expect(hostile.record.sessions[0]?.origin).toBe(
      'https://centro-color-web.vercel.app',
    );
  });

  it('copies sólo aplica a laboratorio; edición queda en 1', async () => {
    const ctx = setup();
    const { token, link } = await issueLink(ctx.state);
    const response = await post(handleUploadSession, ctx.deps, {
      token,
      destinationId: await editDestination(link.id),
      ...photo('vieja.png'),
      copies: 5,
    });
    expect(response.status).toBe(200);
    expect(ctx.state.files[0]).toMatchObject({
      workflow_route: 'editing',
      copies: 1,
    });
  });

  it.each([
    ['formato no admitido', { filename: 'virus.exe' }, 'invalid_format'],
    ['sin extensión', { filename: 'foto' }, 'invalid_format'],
    ['MIME no fotográfico', { mimeType: 'application/pdf' }, 'invalid_mime'],
    ['MIME malformado', { mimeType: 'image/jpeg\r\nX: y' }, 'invalid_mime'],
    ['tamaño cero', { sizeBytes: 0 }, 'invalid_size'],
    ['tamaño fraccional', { sizeBytes: 10.5 }, 'invalid_size'],
    ['tamaño excesivo', { sizeBytes: 3 * 1024 ** 3 }, 'invalid_size'],
    ['copies cero', { copies: 0 }, 'invalid_copies'],
    ['copies fraccional', { copies: 1.5 }, 'invalid_copies'],
    ['copies enorme', { copies: 100000 }, 'invalid_copies'],
  ])('rechaza %s', async (_name, overrides, code) => {
    const { response, state } = await session(overrides);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code });
    expect(state.files).toHaveLength(0);
  });

  it('rechaza un destino de otro pedido, de otro link o sin archivos requeridos', async () => {
    const ctx = setup();
    const first = await issueLink(ctx.state);
    const second = await issueLink(ctx.state);
    // destino del primer link usado con el token del segundo
    const crossLink = await post(handleUploadSession, ctx.deps, {
      token: second.token,
      destinationId: await labDestination(first.link.id),
      ...photo(),
    });
    expect(crossLink.status).toBe(403);
    const plain = await post(handleUploadSession, ctx.deps, {
      token: first.token,
      destinationId: await destinationId(
        ENV.PHOTO_UPLOAD_SIGNING_SECRET!,
        first.link.id,
        ITEM_PLAIN,
      ),
      ...photo(),
    });
    expect(plain.status).toBe(403);
    const invented = await post(handleUploadSession, ctx.deps, {
      token: first.token,
      destinationId: 'f'.repeat(32),
      ...photo(),
    });
    expect(invented.status).toBe(403);
    expect(ctx.state.files).toHaveLength(0);
  });

  it('Drive desconectado -> 503 sin detalles del negocio y deja la carga fallida', async () => {
    const { response, state, logger } = await session(
      {},
      {
        drive: {
          accessError: new ApiError(
            'Google Drive no está conectado.',
            409,
            'drive_not_connected',
          ),
        },
      },
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe('storage_unavailable');
    expect(body.error).not.toContain('Drive no está conectado');
    expect(logger).toHaveBeenCalledWith(
      'error',
      'photo_upload_business_side_failure',
      expect.objectContaining({ code: 'drive_not_connected' }),
    );
    expect(state.files).toHaveLength(0);
  });

  it('si Drive rechaza abrir la sesión, la fila queda failed (no colgada en pending)', async () => {
    const { response, state } = await session(
      {},
      {
        drive: {
          failOn: {
            init: new ApiError('x', 503, 'drive_unavailable'),
          },
        },
      },
    );
    expect(response.status).toBe(503);
    expect(state.files[0]?.status).toBe('failed');
  });

  it('el reintento marca como failed el intento anterior', async () => {
    const ctx = setup();
    const { token, link } = await issueLink(ctx.state);
    const body = {
      token,
      destinationId: await labDestination(link.id),
      ...photo(),
    };
    const first = await (
      await post(handleUploadSession, ctx.deps, body)
    ).json();
    const second = await post(handleUploadSession, ctx.deps, {
      ...body,
      previousUploadId: first.uploadId,
    });
    expect(second.status).toBe(200);
    expect(ctx.state.files.map((x) => x.status)).toEqual([
      'failed',
      'uploading',
    ]);
  });

  it('el límite por minuto admite subidas secuenciales grandes pero frena abusos', async () => {
    const ctx = setup();
    const { token, link } = await issueLink(ctx.state);
    const destination = await labDestination(link.id);
    for (let i = 0; i < 60; i += 1)
      ctx.state.files.push({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        business_id: BUSINESS_A,
        photo_job_id: JOB_A,
        photo_job_item_id: ITEM_LAB,
        drive_file_id: `d${i}`,
        drive_folder_id: 'f',
        original_filename: 'a.jpg',
        stored_filename: 'x-a.jpg',
        mime_type: null,
        size_bytes: 1,
        copies: 1,
        workflow_route: 'lab',
        status: 'uploaded',
        uploaded_at: null,
        created_at: new Date(NOW - 5_000).toISOString(),
      });
    const ok = await post(handleUploadSession, ctx.deps, {
      token,
      destinationId: destination,
      ...photo(),
    });
    expect(ok.status).toBe(200);
    for (let i = 60; i < 125; i += 1)
      ctx.state.files.push({
        ...ctx.state.files[0]!,
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        drive_file_id: `d${i}`,
      });
    const blocked = await post(handleUploadSession, ctx.deps, {
      token,
      destinationId: destination,
      ...photo(),
    });
    expect(blocked.status).toBe(429);
  });

  it('los intentos fallidos no consumen el cupo de 500 archivos', async () => {
    const ctx = setup();
    const { token, link } = await issueLink(ctx.state);
    for (let i = 0; i < 600; i += 1)
      ctx.state.files.push({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        business_id: BUSINESS_A,
        photo_job_id: JOB_A,
        photo_job_item_id: ITEM_LAB,
        drive_file_id: `d${i}`,
        drive_folder_id: 'f',
        original_filename: 'a.jpg',
        stored_filename: 'x-a.jpg',
        mime_type: null,
        size_bytes: 1,
        copies: 1,
        workflow_route: 'lab',
        status: 'failed',
        uploaded_at: null,
        created_at: '2026-10-10T00:00:00Z',
      });
    const response = await post(handleUploadSession, ctx.deps, {
      token,
      destinationId: await labDestination(link.id),
      ...photo(),
    });
    expect(response.status).toBe(200);
  });
});

describe('portal público — finalize y submit', () => {
  async function uploaded(overrides: FakeDriveOptions = {}) {
    const ctx = setup(overrides);
    const { token, link } = await issueLink(ctx.state);
    const response = await post(handleUploadSession, ctx.deps, {
      token,
      destinationId: await labDestination(link.id),
      ...photo('IMG_1.jpg', 2048),
      copies: 2,
    });
    const { uploadId } = await response.json();
    return { ...ctx, token, link, uploadId };
  }

  it('finalize verifica en Drive y es idempotente', async () => {
    const ctx = await uploaded();
    const first = await post(handleUploadFinalize, ctx.deps, {
      token: ctx.token,
      uploadId: ctx.uploadId,
    });
    expect(first.status).toBe(200);
    expect(ctx.state.files[0]?.status).toBe('uploaded');
    const uploadedAt = ctx.state.files[0]!.uploaded_at;
    expect(uploadedAt).toBe(new Date(NOW).toISOString());
    const again = await post(handleUploadFinalize, ctx.deps, {
      token: ctx.token,
      uploadId: ctx.uploadId,
    });
    expect(again.status).toBe(200);
    await expect(again.json()).resolves.toMatchObject({ uploadedAt });
  });

  it('finalize rechaza un tamaño incompleto', async () => {
    const ctx = await uploaded({
      getFileOverride: (file) => ({
        id: file.drive_file_id,
        name: file.stored_filename,
        size: '10',
        parents: [file.drive_folder_id],
      }),
    });
    const response = await post(handleUploadFinalize, ctx.deps, {
      token: ctx.token,
      uploadId: ctx.uploadId,
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'drive_verification_failed',
    });
    expect(ctx.state.files[0]?.status).toBe('uploading');
  });

  it('finalize rechaza carpeta/padre incorrecto, nombre distinto o archivo en papelera', async () => {
    for (const mutate of [
      (f: {
        drive_folder_id: string;
        stored_filename: string;
        size_bytes: number;
      }) => ({
        parents: ['otra-carpeta'],
        size: String(f.size_bytes),
        name: f.stored_filename,
      }),
      (f: {
        drive_folder_id: string;
        stored_filename: string;
        size_bytes: number;
      }) => ({
        parents: [f.drive_folder_id],
        size: String(f.size_bytes),
        name: 'otro.jpg',
      }),
      (f: {
        drive_folder_id: string;
        stored_filename: string;
        size_bytes: number;
      }) => ({
        parents: [f.drive_folder_id],
        size: String(f.size_bytes),
        name: f.stored_filename,
        trashed: true,
      }),
    ]) {
      const ctx = await uploaded({
        getFileOverride: (file) => ({
          id: file.drive_file_id,
          ...mutate(file),
        }),
      });
      const response = await post(handleUploadFinalize, ctx.deps, {
        token: ctx.token,
        uploadId: ctx.uploadId,
      });
      expect(response.status).toBe(409);
    }
  });

  it('finalize: si Drive aún no tiene el archivo devuelve 409 reintentable', async () => {
    const ctx = await uploaded({
      getFileOverride: () =>
        new ApiError(
          'El archivo todavía no llegó completo. Reintentá en unos segundos.',
          409,
          'drive_file_missing',
        ),
    });
    const response = await post(handleUploadFinalize, ctx.deps, {
      token: ctx.token,
      uploadId: ctx.uploadId,
    });
    expect(response.status).toBe(409);
    expect(ctx.state.files[0]?.status).toBe('uploading');
  });

  it('finalize no acepta cargas de otro pedido ni ya fallidas', async () => {
    const ctx = await uploaded();
    const other = await issueLink(ctx.state, {
      jobId: JOB_B,
      businessId: '22222222-2222-4222-8222-222222222222',
    });
    const foreign = await post(handleUploadFinalize, ctx.deps, {
      token: other.token,
      uploadId: ctx.uploadId,
    });
    expect(foreign.status).toBe(404);
    ctx.state.files[0]!.status = 'failed';
    const failed = await post(handleUploadFinalize, ctx.deps, {
      token: ctx.token,
      uploadId: ctx.uploadId,
    });
    expect(failed.status).toBe(409);
    await expect(failed.json()).resolves.toMatchObject({
      code: 'upload_not_active',
    });
    expect(
      (
        await post(handleUploadFinalize, ctx.deps, {
          token: ctx.token,
          uploadId: 'no-es-uuid',
        })
      ).status,
    ).toBe(400);
  });

  async function readyToSubmit() {
    const ctx = await uploaded();
    await post(handleUploadFinalize, ctx.deps, {
      token: ctx.token,
      uploadId: ctx.uploadId,
    });
    return ctx;
  }

  it('submit escribe PEDIDO.txt, marca submitted y cierra el link', async () => {
    const ctx = await readyToSubmit();
    const response = await post(handleUploadSubmit, ctx.deps, {
      token: ctx.token,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.warnings).toEqual([
      'Foto 10x15: 2 copias enviadas de 4 pedidas.',
    ]);
    expect(ctx.record.manifests).toHaveLength(1);
    expect(ctx.record.manifests[0]?.parent).toBe(
      `job-folder-${JOB_A.slice(0, 4)}`,
    );
    expect(ctx.record.manifests[0]?.text).toBe(
      [
        'Cliente: María García',
        'Código Job: CC-AAAAAAAA',
        '',
        'Foto 10x15 (10 x 15 cm)',
        'IMG_1.jpg | 2 copias',
        '',
      ].join('\r\n'),
    );
    expect(ctx.state.jobs.find((x) => x.id === JOB_A)?.file_intake_status).toBe(
      'submitted',
    );
    expect(ctx.state.links[0]?.submitted_at).toBeTruthy();
    // El link ya no sirve para subir ni para el contexto.
    expect(
      (await post(handleUploadContext, ctx.deps, { token: ctx.token })).status,
    ).toBe(409);
  });

  it('submit es idempotente', async () => {
    const ctx = await readyToSubmit();
    await post(handleUploadSubmit, ctx.deps, { token: ctx.token });
    const again = await post(handleUploadSubmit, ctx.deps, {
      token: ctx.token,
    });
    await expect(again.json()).resolves.toEqual({
      ok: true,
      alreadySubmitted: true,
    });
    expect(ctx.record.manifests).toHaveLength(1);
  });

  it('submit rechaza sin archivos o con cargas pendientes', async () => {
    const empty = setup();
    const emptyLink = await issueLink(empty.state);
    const none = await post(handleUploadSubmit, empty.deps, {
      token: emptyLink.token,
    });
    expect(none.status).toBe(409);
    await expect(none.json()).resolves.toMatchObject({
      code: 'no_uploaded_files',
    });

    const ctx = await uploaded();
    const pending = await post(handleUploadSubmit, ctx.deps, {
      token: ctx.token,
    });
    expect(pending.status).toBe(409);
    await expect(pending.json()).resolves.toMatchObject({
      code: 'uploads_pending',
    });
  });

  it('si PEDIDO.txt falla en Drive, el job NO queda submitted y el link sigue abierto', async () => {
    const ctx = await uploaded({
      failOn: { manifest: new ApiError('x', 503, 'drive_unavailable') },
    });
    await post(handleUploadFinalize, ctx.deps, {
      token: ctx.token,
      uploadId: ctx.uploadId,
    });
    const response = await post(handleUploadSubmit, ctx.deps, {
      token: ctx.token,
    });
    expect(response.status).toBe(503);
    expect(ctx.state.jobs.find((x) => x.id === JOB_A)?.file_intake_status).toBe(
      'receiving',
    );
    expect(ctx.state.links[0]?.submitted_at).toBeNull();
  });
});

describe('PEDIDO.txt', () => {
  it('agrupa por servicio, omite items sin archivos y no advierte fuera de laboratorio', () => {
    const { jobs } = seedState();
    const job = jobs.find((x) => x.id === JOB_A)!;
    const { text, warnings } = buildManifest(job, [
      {
        photo_job_item_id: ITEM_LAB,
        original_filename: 'a.jpg',
        copies: 1,
        workflow_route: 'lab',
      },
      {
        photo_job_item_id: ITEM_LAB,
        original_filename: 'b.jpg',
        copies: 3,
        workflow_route: 'lab',
      },
      {
        photo_job_item_id: ITEM_EDIT,
        original_filename: 'vieja.png',
        copies: 1,
        workflow_route: 'editing',
      },
    ]);
    expect(warnings).toEqual([]);
    expect(text.split('\r\n')).toEqual([
      'Cliente: María García',
      'Código Job: CC-AAAAAAAA',
      '',
      'Foto 10x15 (10 x 15 cm)',
      'a.jpg | 1 copia',
      'b.jpg | 3 copias',
      '',
      'Restauración',
      'vieja.png | 1 copia',
      '',
    ]);
  });
});
