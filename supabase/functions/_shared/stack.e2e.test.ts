// End-to-end contract test across layers, with real code on both sides:
//   Web repository / portal client  →  Edge handlers  →  store + Drive doubles.
// It exists because each layer used to pass its own tests while the contract between
// them (payload keys, error bodies, status codes) was only checked in production.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabasePhotoFileIntakeAdminRepository } from '../../../apps/web/src/photo-file-intake';
import {
  call,
  contextBody,
  finalizeBody,
  sessionBody,
  submitBody,
  uploadChunks,
  type UploadContext,
  type UploadSession,
} from '../../../apps/web/src/photo-upload-client';
import { ApiError } from './http';
import {
  handlePhotoFileAdmin,
  type AdminDeps,
} from './photo-file-admin-handler';
import {
  ITEM_EDIT,
  ITEM_LAB,
  JOB_A,
  JOB_B,
  createFakeDrive,
  createFakeStore,
  defaultUsers,
  fakeAuthenticator,
  getEnv,
  seedState,
  type FakeDriveOptions,
} from './test-support';
import {
  handleUploadContext,
  handleUploadFinalize,
  handleUploadSession,
  handleUploadSubmit,
  type PublicDeps,
} from './upload-handlers';

const SUPABASE_URL = 'https://project.supabase.co';
let currentJwt = 'jwt-owner';
let world: ReturnType<typeof createWorld>;

// supabase-js client double: FunctionsHttpError carries the Response in `context`.
vi.mock('../../../apps/web/src/cloud-config', () => ({
  getSupabaseClient: () => ({
    functions: {
      async invoke(name: string, options: { body: unknown }) {
        const handlers: Record<string, () => Promise<Response>> = {
          'photo-file-admin': () =>
            handlePhotoFileAdmin(
              new Request(`${SUPABASE_URL}/functions/v1/${name}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${currentJwt}`,
                },
                body: JSON.stringify(options.body),
              }),
              world.adminDeps,
            ),
        };
        const response = await handlers[name]!();
        if (!response.ok) {
          const error = new Error(
            'Edge Function returned a non-2xx status code',
          );
          error.name = 'FunctionsHttpError';
          Object.assign(error, { context: response });
          return { data: null, error };
        }
        return { data: await response.json(), error: null };
      },
    },
    from: () => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          single: async () => {
            // RLS: a user only sees jobs of Businesses where they have a membership.
            const job = world.state.jobs.find(
              (x) =>
                x.id === id &&
                defaultUsers[currentJwt]?.memberships.some(
                  (m) => m.business_id === x.business_id,
                ),
            );
            return job
              ? { data: { business_id: job.business_id }, error: null }
              : { data: null, error: { message: 'no rows' } };
          },
        }),
      }),
    }),
  }),
}));

function createWorld(drive: FakeDriveOptions = {}) {
  const state = seedState();
  const store = createFakeStore(state);
  const fake = createFakeDrive(store, state, drive);
  const logger = vi.fn();
  const publicDeps: PublicDeps = { store, drive: fake.drive, getEnv, logger };
  const adminDeps: AdminDeps = {
    authenticate: fakeAuthenticator(defaultUsers),
    services: () => ({ store, drive: fake.drive }),
    getEnv,
    logger,
  };
  return { state, store, record: fake.record, logger, publicDeps, adminDeps };
}

/** Browser fetch double: Edge Function URLs hit the handlers; Drive session URLs emulate resumable PUTs. */
function installFetch() {
  const received = new Map<string, number>();
  const driveCalls: { headers: Headers; status: number }[] = [];
  const routes: Record<string, (r: Request) => Promise<Response>> = {
    'photo-upload-context': (r) => handleUploadContext(r, world.publicDeps),
    'photo-upload-session': (r) => handleUploadSession(r, world.publicDeps),
    'photo-upload-finalize': (r) => handleUploadFinalize(r, world.publicDeps),
    'photo-upload-submit': (r) => handleUploadSubmit(r, world.publicDeps),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.startsWith(`${SUPABASE_URL}/functions/v1/`)) {
        const name = url.split('/').pop()!;
        return routes[name]!(new Request(url, init));
      }
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
        const headers = new Headers(init.headers);
        const range = /bytes (?:(\d+)-(\d+)|\*)\/(\d+)/.exec(
          headers.get('Content-Range') ?? '',
        )!;
        const total = Number(range[3]);
        if (range[1] === undefined) {
          const got = received.get(url) ?? 0;
          return got >= total
            ? new Response('{}', { status: 200 })
            : new Response(null, {
                status: 308,
                headers: got ? { Range: `bytes=0-${got - 1}` } : {},
              });
        }
        const end = Number(range[2]) + 1;
        received.set(url, end);
        const response =
          end >= total
            ? new Response('{}', { status: 200 })
            : new Response(null, {
                status: 308,
                headers: { Range: `bytes=0-${end - 1}` },
              });
        driveCalls.push({ headers, status: response.status });
        return response;
      }
      throw new Error(`fetch inesperado: ${url}`);
    }),
  );
  return { driveCalls };
}

beforeEach(() => {
  currentJwt = 'jwt-owner';
  world = createWorld();
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const repository = () => new SupabasePhotoFileIntakeAdminRepository();

const file = (name: string, size: number, type = 'image/jpeg') => {
  const blob = new Blob([new Uint8Array(size)], { type }) as File;
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
};

describe('Admin → link: lo que ve la UI', () => {
  it('owner genera el link desde la UI y obtiene una URL pública usable', async () => {
    const link = await repository().createUploadLink(JOB_A);
    expect(link.url).toMatch(
      /^https:\/\/centro-color-web\.vercel\.app\/enviar\/[A-Za-z0-9_-]{43}$/,
    );
    expect(link.revokedAt).toBeNull();
    expect(world.state.jobs[0]?.file_intake_status).toBe('awaiting_files');
    const again = await repository().getUploadLink(JOB_A);
    expect(again).toMatchObject({ id: link.id, url: null });
  });

  it('admin también puede; regenerar revoca el anterior', async () => {
    currentJwt = 'jwt-admin';
    const first = await repository().createUploadLink(JOB_A);
    const second = await repository().createUploadLink(JOB_A);
    expect(second.id).not.toBe(first.id);
    await repository().revokeUploadLink(JOB_A);
    expect(world.state.links.every((x) => x.revoked_at)).toBe(true);
  });

  it('staff ve un mensaje útil en vez de "non-2xx status code"', async () => {
    currentJwt = 'jwt-staff';
    await expect(repository().createUploadLink(JOB_A)).rejects.toThrow(
      'No se pudo generar el link del cliente: Se requiere rol owner o admin.',
    );
  });

  it('Drive desconectado: "No se pudo generar el link del cliente: Google Drive no está conectado."', async () => {
    world = createWorld({
      accessError: new ApiError(
        'Google Drive no está conectado.',
        409,
        'drive_not_connected',
      ),
    });
    const failure = repository().createUploadLink(JOB_A);
    await expect(failure).rejects.toThrow(
      'No se pudo generar el link del cliente: Google Drive no está conectado.',
    );
    await failure.catch((error) => {
      expect(error.message).not.toContain('non-2xx');
      expect(error).toMatchObject({ status: 409, code: 'drive_not_connected' });
    });
  });

  it('sin permisos de base (el bug real): mensaje genérico con referencia, detalle sólo en logs', async () => {
    world.state.failures.add('photo_job_upload_links.insert');
    const failure = repository().createUploadLink(JOB_A);
    await expect(failure).rejects.toThrow(
      /^No se pudo generar el link del cliente: No se pudo completar la operación\. \(ref\. [0-9a-f]{8}\)$/,
    );
    expect(world.logger).toHaveBeenCalledWith(
      'error',
      'photo_file_admin_database_error',
      expect.objectContaining({
        operation: 'photo_job_upload_links.insert',
        databaseError: expect.objectContaining({ code: '42501' }),
      }),
    );
  });

  it('un Job de otro Business se informa como no encontrado', async () => {
    await expect(repository().createUploadLink(JOB_B)).rejects.toThrow(
      'No se pudo generar el link del cliente: no se encontró el trabajo fotográfico.',
    );
    expect(world.state.links).toHaveLength(0);
  });
});

describe('Admin → link → portal → Drive → finalize → submit → Producción', () => {
  it('recorre todo el flujo con las cargas y deja las colas listas', async () => {
    const { driveCalls } = installFetch();
    const link = await repository().createUploadLink(JOB_A);
    const token = link.url!.split('/').pop()!;

    const context = await call<UploadContext>(
      'photo-upload-context',
      contextBody(token),
    );
    expect(context.destinations.map((x) => x.workflowRoute)).toEqual([
      'lab',
      'editing',
    ]);
    const [lab, editing] = context.destinations;

    const uploads = [
      { destination: lab!, photo: file('IMG_1.jpg', 20_000), copies: 2 },
      { destination: lab!, photo: file('IMG_2.jpg', 5_000), copies: 2 },
      {
        destination: editing!,
        photo: file('vieja.png', 7_000, 'image/png'),
        copies: 1,
      },
    ];
    for (const upload of uploads) {
      const session = await call<UploadSession>(
        'photo-upload-session',
        sessionBody(
          token,
          upload.destination.destinationId,
          upload.photo,
          upload.copies,
        ),
      );
      const progress: number[] = [];
      await uploadChunks(
        upload.photo,
        session.uploadUrl,
        8_192, // varios chunks: 308 en los intermedios, 200 en el último
        (value) => progress.push(value),
      );
      expect(progress.at(-1)).toBe(100);
      await call(
        'photo-upload-finalize',
        finalizeBody(token, session.uploadId),
      );
    }
    expect(driveCalls.some((x) => x.status === 308)).toBe(true);
    expect(driveCalls.at(-1)?.status).toBe(200);

    const result = await call<{ ok: boolean; warnings: string[] }>(
      'photo-upload-submit',
      submitBody(token),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    // Estado que consume Producción (Laboratorio / Edición).
    const job = world.state.jobs.find((x) => x.id === JOB_A)!;
    expect(job.file_intake_status).toBe('submitted');
    expect(world.state.links[0]?.submitted_at).toBeTruthy();
    const uploaded = world.state.files.filter((x) => x.status === 'uploaded');
    expect(uploaded).toHaveLength(3);
    const byItem = (itemId: string) =>
      uploaded.filter((x) => x.photo_job_item_id === itemId);
    expect(byItem(ITEM_LAB).map((x) => x.workflow_route)).toEqual([
      'lab',
      'lab',
    ]);
    expect(byItem(ITEM_LAB).reduce((sum, x) => sum + x.copies, 0)).toBe(4);
    expect(byItem(ITEM_EDIT).map((x) => x.workflow_route)).toEqual(['editing']);
    expect(world.record.manifests).toHaveLength(1);
    expect(world.record.manifests[0]?.text).toContain('IMG_1.jpg | 2 copias');
    expect(world.record.manifests[0]?.text).toContain('vieja.png | 1 copia');

    // El link quedó cerrado: el portal informa y no vuelve a aceptar archivos.
    await expect(
      call('photo-upload-context', contextBody(token)),
    ).rejects.toThrow('Este envío ya fue finalizado.');
  });

  it('el portal muestra el mensaje del servidor, no un genérico', async () => {
    installFetch();
    await expect(
      call('photo-upload-context', contextBody('x'.repeat(43))),
    ).rejects.toThrow('Link inválido.');
    const link = await repository().createUploadLink(JOB_A);
    await repository().revokeUploadLink(JOB_A);
    await expect(
      call('photo-upload-context', contextBody(link.url!.split('/').pop()!)),
    ).rejects.toThrow('Este link fue revocado.');
  });

  it('los cuerpos del frontend coinciden con el esquema de cada función (claves exactas)', () => {
    expect(Object.keys(contextBody('t'))).toEqual(['token']);
    expect(
      Object.keys(
        sessionBody(
          't',
          'd',
          { name: 'a.jpg', type: 'image/jpeg', size: 1 },
          1,
        ),
      ).sort(),
    ).toEqual(
      [
        'copies',
        'destinationId',
        'filename',
        'mimeType',
        'previousUploadId',
        'sizeBytes',
        'token',
      ].sort(),
    );
    expect(Object.keys(finalizeBody('t', 'u'))).toEqual(['token', 'uploadId']);
    expect(Object.keys(submitBody('t'))).toEqual(['token']);
  });
});
