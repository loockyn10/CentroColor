/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies and PostgREST rows are untyped here. */
// Portal profesional, código del navegador ↔ backend, con código real de los dos lados: el
// cliente Web, el modelo (carpetas, copias, líneas) y la coreografía de subida compartida con
// /imprimir corren contra los handlers, los stores y las migraciones reales.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EdgeFunctionError } from '../../../apps/web/src/edge-functions';
import {
  SupabaseProfessionalAdminRepository,
  professionalAdminBody,
} from '../../../apps/web/src/professional-admin';
import {
  fetchProfessionalCatalog,
  serverMessage,
  startProfessionalOrder,
  submitProfessionalOrder,
} from '../../../apps/web/src/professional/client';
import {
  applyCopiesToAll,
  classifyPickedFiles,
  planAdditions,
  PRO_UPLOAD_CONCURRENCY,
  startProfessionalBody,
} from '../../../apps/web/src/professional/model';
import {
  deriveLines,
  type PhotoEntry,
} from '../../../apps/web/src/public-order/model';
import { catalogSizes } from '../../../apps/web/src/public-order/order-blocks';
import {
  buildSubmitOptions,
  errorCode,
  isIncompleteOrder,
  sendEntries,
  type UploadProgress,
} from '../../../apps/web/src/public-order/order-submission';
import { assertBusinessAdmin } from './authorization';
import { ApiError } from './http';
import { IDS } from './pg-harness';
import { U, seedProfessionalWorld } from './pg-professional-fixtures';
import { createPgServiceDb } from './pg-service-db';
import { createWorld, worldEnv, type World } from './pg-world';
import {
  createProfessionalAdminStore,
  handleProfessionalAdmin,
} from './professional-admin-handler';
import {
  handleProfessionalCatalog,
  handleProfessionalOrderStart,
  handleProfessionalOrderSubmit,
  type ProfessionalDeps,
} from './professional-handlers';
import { handleUploadFinalize, handleUploadSession } from './upload-handlers';

let w: World;
let jwt = 'jwt-studio';
let variants: Record<string, string>;
const USERS: Record<string, string> = {
  'jwt-studio': U.studio,
  'jwt-diego': U.diego,
  'jwt-plain': U.plain,
  'jwt-owner': IDS.owner,
  'jwt-staff': IDS.staff,
};

const proDeps = (): ProfessionalDeps => ({
  ...w.orderDeps,
  authenticate: async (request) => {
    const userId =
      USERS[
        (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
      ];
    if (!userId)
      throw new ApiError('Autorización inválida.', 401, 'unauthorized');
    return { userId };
  },
});
const adminDeps = () => ({
  authenticate: async (request: Request, businessId: string) => {
    const userId =
      USERS[
        (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
      ];
    if (!userId)
      throw new ApiError('Autorización inválida.', 401, 'unauthorized');
    const membership =
      (
        await w.db.query<any>(
          `select business_id,user_id,role,is_active from public.business_memberships where user_id=$1`,
          [userId],
        )
      ).rows[0] ?? null;
    assertBusinessAdmin(userId, businessId, membership);
    return { user: { id: userId }, membership };
  },
  store: () => createProfessionalAdminStore(createPgServiceDb(w.db)),
  inviteUser: async (email: string) => {
    const id = '92000000-0000-4000-8000-000000000001';
    await w.db.query(`insert into auth.users(id,email) values($1,$2)`, [
      id,
      email,
    ]);
    return id;
  },
  getEnv: worldEnv,
  logger: w.logger,
});

// supabase-js stand-in: `functions.invoke` runs the real handlers with the signed-in JWT.
vi.mock('../../../apps/web/src/cloud-config', () => ({
  getSupabaseClient: () => ({
    functions: {
      async invoke(name: string, options: { body: unknown }) {
        const handler: Record<string, (r: Request) => Promise<Response>> = {
          'professional-catalog': (r) =>
            handleProfessionalCatalog(r, proDeps()),
          'professional-order-start': (r) =>
            handleProfessionalOrderStart(r, proDeps()),
          'professional-order-submit': (r) =>
            handleProfessionalOrderSubmit(r, proDeps()),
          'professional-admin': (r) => handleProfessionalAdmin(r, adminDeps()),
        };
        const response = await handler[name]!(
          new Request(`https://project.supabase.co/functions/v1/${name}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify(options.body),
          }),
        );
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
  }),
}));

/**
 * The browser's network for the token-based upload functions and Drive's resumable PUT. Each
 * upload URL is tied to the file its session created, so photos can travel concurrently.
 */
function installNetwork(options: { failSession?: Set<string> } = {}) {
  const sessionCalls: string[] = [];
  const urlToUpload = new Map<string, string>();
  let inFlight = 0;
  const stats = { peak: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      if (url.hostname === 'www.googleapis.com') {
        const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(
          String((init.headers as any)?.['Content-Range'] ?? ''),
        );
        if (range && Number(range[2]) + 1 === Number(range[3])) {
          const uploadId = urlToUpload.get(String(input))!;
          const row = (
            await w.db.query<any>(
              `select drive_file_id from public.photo_job_files where id=$1`,
              [uploadId],
            )
          ).rows[0];
          (w.google.files.find((f) => f.id === row.drive_file_id) as any).text =
            'x'.repeat(Number(range[3]));
          return new Response('{}', { status: 200 });
        }
        return new Response(null, {
          status: 308,
          headers: { Range: `bytes=0-${range?.[2] ?? 0}` },
        });
      }
      const name = url.pathname.split('/functions/v1/')[1]!;
      const request = new Request(url, init);
      inFlight += 1;
      stats.peak = Math.max(stats.peak, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (name === 'photo-upload-session') {
          const body = await request.clone().json();
          sessionCalls.push(body.filename);
          if (options.failSession?.has(body.filename))
            return new Response(
              JSON.stringify({ error: 'Servicio ocupado.', code: 'busy' }),
              { status: 503, headers: { 'Content-Type': 'application/json' } },
            );
          const response = await handleUploadSession(request, w.uploadDeps);
          const payload = await response.clone().json();
          if (payload.uploadUrl)
            urlToUpload.set(payload.uploadUrl, payload.uploadId);
          return response;
        }
        if (name === 'photo-upload-finalize')
          return await handleUploadFinalize(request, w.uploadDeps);
        throw new Error(`unrouted ${name}`);
      } finally {
        inFlight -= 1;
      }
    }),
  );
  return { sessionCalls, stats };
}

const photo = (name: string, bytes = 20) =>
  new File(['x'.repeat(bytes)], name, { type: 'image/jpeg', lastModified: 1 });

beforeEach(async () => {
  w = await createWorld();
  ({ variants } = await seedProfessionalWorld(w));
  jwt = 'jwt-studio';
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('portal profesional: cliente web ↔ funciones reales', () => {
  it('carpeta de 120 fotos: catálogo → copias para todas → pedido → subida concurrente limitada → confirmación', async () => {
    const network = installNetwork();
    const catalog = await fetchProfessionalCatalog();
    expect(catalog.account).toMatchObject({
      customerName: 'Estudio Luz',
      priceListName: 'Profesional',
      paymentTerms: 'prepaid',
    });
    const sizes = catalogSizes(catalog.services);
    expect(sizes.map((s) => [s.name, s.papers.map((p) => p.label)])).toEqual([
      ['10x15', ['Brillo', 'Mate']],
      ['13x18', ['Brillo']],
    ]);
    const glossy = sizes[0]!.papers[0]!.service.id;
    const matte = sizes[0]!.papers[1]!.service.id;

    // La carpeta exportada de Lightroom: 120 fotos, un catálogo, sidecars y un archivo de sistema.
    const folder = [
      ...Array.from({ length: 120 }, (_, i) => photo(`IMG_${i + 1}.jpg`)),
      new File(['x'], 'Boda.lrcat'),
      new File(['x'], 'IMG_1.xmp'),
      new File(['x'], '.DS_Store'),
    ];
    const picked = classifyPickedFiles(folder);
    expect(picked.accepted).toHaveLength(120);
    expect(picked.ignored).toBe(3);
    let entries = planAdditions([], glossy, picked.accepted).entries;
    expect(entries.map((e) => e.file.name).slice(0, 3)).toEqual([
      'IMG_1.jpg',
      'IMG_2.jpg',
      'IMG_3.jpg',
    ]);
    // Mismas fotos, otro formato; y una copia más para todas las de brillo.
    const second = planAdditions(entries, matte, picked.accepted.slice(0, 30));
    entries = [...entries, ...second.entries];
    entries = applyCopiesToAll(entries, glossy, 2);
    entries = entries.map((e) =>
      e.id === entries[0]!.id ? { ...e, copies: 5 } : e,
    );
    const selected = [glossy, matte];
    const lines = deriveLines(catalog.services, selected, entries);
    // Brillo: 119×2 + 5 = 243 copias (tramo 100+ a 250); Mate: 30 copias a 320.
    expect(
      lines.map((l) => [l.copies, l.unitPriceCents, l.totalCents]),
    ).toEqual([
      [243, 25000, 243 * 25000],
      [30, 32000, 30 * 32000],
    ]);

    const started = await startProfessionalOrder(
      startProfessionalBody(
        'pro-client-key-aaaaaaaa',
        '342 555 9999',
        '',
        lines,
      ),
    );
    expect(started.totalCents).toBe(243 * 25000 + 30 * 32000);
    expect(started.paymentTerms).toBe('prepaid');

    const attempts = new Map<string, string>();
    const progress = new Map<string, UploadProgress>();
    const failed = await sendEntries({
      started,
      entries,
      attempts,
      concurrency: PRO_UPLOAD_CONCURRENCY,
      onProgress: (id, value) => progress.set(id, value),
    });
    expect(failed).toBe(0);
    expect(attempts.size).toBe(150);
    // Concurrencia limitada: se solapan pero nunca superan el tope (cada foto = 1 llamada a la vez).
    expect(network.stats.peak).toBeGreaterThan(1);
    expect(network.stats.peak).toBeLessThanOrEqual(PRO_UPLOAD_CONCURRENCY);

    const done = await submitProfessionalOrder(
      started.uploadToken,
      buildSubmitOptions({ started, selected, sent: entries, attempts }),
    );
    expect(done.paymentTerms).toBe('prepaid');
    expect(done.items).toEqual([
      {
        name: '10x15 · Brillo · Profesional',
        quantity: 243,
        totalCents: 243 * 25000,
      },
      {
        name: '10x15 · Mate · Profesional',
        quantity: 30,
        totalCents: 30 * 32000,
      },
    ]);

    const live = w.google.files.filter(
      (f) =>
        !f.trashed &&
        f.mimeType !== 'application/vnd.google-apps.folder' &&
        f.name !== 'PEDIDO.txt',
    );
    const folderName = (id: string) =>
      w.google.files.find((f) => f.id === id)!.name;
    const names = live
      .map((f) => `${folderName(f.parents[0]!)}/${f.name}`)
      .sort();
    expect(names).toHaveLength(150);
    expect(names).toContain('10x15 · Brillo · Profesional/001_5copias.jpg');
    expect(names).toContain('10x15 · Brillo · Profesional/002_2copias.jpg');
    expect(names).toContain('10x15 · Brillo · Profesional/120_2copias.jpg');
    expect(names).toContain('10x15 · Mate · Profesional/030_1copia.jpg');
    expect(
      (
        await w.db.query<any>(
          `select count(*)::int n from public.photo_job_files where status='uploaded'`,
        )
      ).rows[0].n,
    ).toBe(150);
  }, 120_000);

  it('fallo parcial: sólo las fotos fallidas se reintentan, sin duplicar las que ya llegaron', async () => {
    const failSession = new Set(['IMG_2.jpg', 'IMG_4.jpg']);
    const network = installNetwork({ failSession });
    const catalog = await fetchProfessionalCatalog();
    const service = catalog.services[0]!;
    let entries: PhotoEntry[] = planAdditions(
      [],
      service.id,
      ['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg', 'IMG_4.jpg'].map((n) => photo(n)),
    ).entries;
    entries = applyCopiesToAll(entries, service.id, 2);
    const selected = [service.id];
    const started = await startProfessionalOrder(
      startProfessionalBody(
        'pro-client-key-bbbbbbbb',
        '342 555 9999',
        '',
        deriveLines(catalog.services, selected, entries),
      ),
    );
    const attempts = new Map<string, string>();
    const progress = new Map<string, UploadProgress>();
    const onProgress = (id: string, value: UploadProgress) =>
      progress.set(id, value);

    const first = await sendEntries({
      started,
      entries,
      attempts,
      concurrency: PRO_UPLOAD_CONCURRENCY,
      onProgress,
    });
    expect(first).toBe(2);
    const failedEntries = entries.filter(
      (e) => progress.get(e.id)?.status === 'failed',
    );
    expect(failedEntries.map((e) => e.file.name).sort()).toEqual([
      'IMG_2.jpg',
      'IMG_4.jpg',
    ]);

    // Sin las dos fotos que fallaron el servidor no confirma el pedido como completo…
    const incomplete = await submitProfessionalOrder(
      started.uploadToken,
      buildSubmitOptions({ started, selected, sent: entries, attempts }),
    ).catch((error) => error);
    expect(isIncompleteOrder(incomplete)).toBe(true);
    expect(errorCode(incomplete)).toBe('order_incomplete');

    // …se reenvían SÓLO esas dos (el servicio ya se recuperó) y el pedido se confirma.
    failSession.clear();
    const before = network.sessionCalls.length;
    expect(
      await sendEntries({
        started,
        entries: failedEntries,
        attempts,
        concurrency: PRO_UPLOAD_CONCURRENCY,
        onProgress,
      }),
    ).toBe(0);
    expect(network.sessionCalls.slice(before).sort()).toEqual([
      'IMG_2.jpg',
      'IMG_4.jpg',
    ]);
    const done = await submitProfessionalOrder(
      started.uploadToken,
      buildSubmitOptions({ started, selected, sent: entries, attempts }),
    );
    expect(done.items[0]).toMatchObject({ quantity: 8 });
    expect(
      (
        await w.db.query<any>(
          `select count(*)::int n from public.photo_job_files where status='uploaded'`,
        )
      ).rows[0].n,
    ).toBe(4);
  }, 60_000);

  it('si la confirmación se corta, volver a confirmar retoma el mismo pedido sin subir nada dos veces', async () => {
    installNetwork();
    const catalog = await fetchProfessionalCatalog();
    const service = catalog.services[0]!;
    let entries: PhotoEntry[] = planAdditions(
      [],
      service.id,
      ['A.jpg', 'B.jpg', 'C.jpg'].map((n) => photo(n)),
    ).entries;
    entries = applyCopiesToAll(entries, service.id, 3);
    const selected = [service.id];
    const body = () =>
      startProfessionalBody(
        'pro-client-key-eeeeeeee',
        '342 555 9999',
        '',
        deriveLines(catalog.services, selected, entries),
      );
    const attempts = new Map<string, string>();
    const send = async (started: any) =>
      sendEntries({
        started,
        entries,
        attempts,
        concurrency: PRO_UPLOAD_CONCURRENCY,
        onProgress: () => undefined,
      });
    const first = await startProfessionalOrder(body());
    expect(await send(first)).toBe(0);
    // La respuesta de la confirmación se pierde (corte de red / tiempo agotado): el navegador
    // vuelve a «Confirmar» con la misma clave, vuelve a ofrecer cada foto y confirma.
    const again = await startProfessionalOrder(body());
    expect(again.orderCode).toBe(first.orderCode);
    expect(await send(again)).toBe(0);
    const done = await submitProfessionalOrder(
      again.uploadToken,
      buildSubmitOptions({ started: again, selected, sent: entries, attempts }),
    );
    expect(done.items[0]).toMatchObject({ quantity: 9, totalCents: 9 * 30000 });
    expect(
      (
        await w.db.query<any>(
          `select count(*)::int n from public.photo_job_files where status='uploaded'`,
        )
      ).rows[0].n,
    ).toBe(3);
    expect(
      w.google.files.filter(
        (f) => !f.trashed && /^00\d_3copias\.jpg$/.test(f.name),
      ),
    ).toHaveLength(3);
  }, 60_000);

  it('quien no es profesional recibe un código claro y ningún precio', async () => {
    jwt = 'jwt-owner';
    const error = await fetchProfessionalCatalog().catch((e) => e);
    expect(error).toBeInstanceOf(EdgeFunctionError);
    expect(errorCode(error)).toBe('not_professional');
    expect(serverMessage(error)).toBe(
      'Esta cuenta no tiene acceso al portal profesional.',
    );
    jwt = 'jwt-bad';
    expect(errorCode(await fetchProfessionalCatalog().catch((e) => e))).toBe(
      'unauthorized',
    );
  });

  it('el pedido pasa por la lista de convenio y declara pago posterior', async () => {
    installNetwork();
    jwt = 'jwt-diego';
    const catalog = await fetchProfessionalCatalog();
    expect(catalog.account.paymentTerms).toBe('deferred');
    const service = catalog.services[0]!;
    const entries = planAdditions([], service.id, [photo('A.jpg')]).entries;
    const lines = deriveLines(catalog.services, [service.id], entries);
    expect(lines[0]!.unitPriceCents).toBe(20000);
    const started = await startProfessionalOrder(
      startProfessionalBody(
        'pro-client-key-cccccccc',
        '342 555 9999',
        '',
        lines,
      ),
    );
    expect(started.paymentTerms).toBe('deferred');
    const attempts = new Map<string, string>();
    await sendEntries({
      started,
      entries,
      attempts,
      concurrency: 2,
      onProgress: () => undefined,
    });
    const done = await submitProfessionalOrder(
      started.uploadToken,
      buildSubmitOptions({
        started,
        selected: [service.id],
        sent: entries,
        attempts,
      }),
    );
    expect(done.paymentTerms).toBe('deferred');
    expect(done.totalCents).toBe(20000);
  });

  it('un formato que ya no está en la lista (precio cambiado) devuelve price_changed', async () => {
    const catalog = await fetchProfessionalCatalog();
    const service = catalog.services[0]!;
    const entries = planAdditions([], service.id, [photo('A.jpg')]).entries;
    const lines = deriveLines(catalog.services, [service.id], entries);
    await w.db.query(
      `update public.lab_price_tiers set unit_price_cents=31000 where variant_id=$1 and min_quantity=1
       and price_list_id=(select id from public.price_lists where kind='professional' and business_id=$2)`,
      [variants.glossy10, IDS.business],
    );
    const error = await startProfessionalOrder(
      startProfessionalBody(
        'pro-client-key-dddddddd',
        '342 555 9999',
        '',
        lines,
      ),
    ).catch((e) => e);
    expect(errorCode(error)).toBe('price_changed');
  });
});

describe('administración Web ↔ función real', () => {
  it('lista, vincula (invitando), cambia el pago posterior y desactiva', async () => {
    jwt = 'jwt-owner';
    const repository = new SupabaseProfessionalAdminRepository();
    const accounts = await repository.list(IDS.business);
    expect(
      accounts.map((a) => [
        a.email,
        a.customerName,
        a.priceListName,
        a.allowDeferredPayment,
        a.priceListUsable,
      ]),
    ).toEqual([
      ['diego@example.com', 'Diego Fotógrafo', 'Convenio Diego', true, true],
      ['estudio@example.com', 'Estudio Luz', 'Profesional', false, true],
    ]);
    const linked = await repository.link(IDS.business, {
      email: 'nuevo@example.com',
      customerId: '91000000-0000-4000-8000-000000000001',
      allowDeferredPayment: true,
    });
    expect(linked.invited).toBe(true);
    const created = linked.accounts.find(
      (a) => a.email === 'nuevo@example.com',
    )!;
    expect(created).toMatchObject({
      allowDeferredPayment: true,
      isActive: true,
    });
    const updated = await repository.update(IDS.business, created.id, {
      isActive: false,
      allowDeferredPayment: false,
    });
    expect(updated.find((a) => a.id === created.id)).toMatchObject({
      isActive: false,
      allowDeferredPayment: false,
    });
    expect(professionalAdminBody('list', IDS.business)).toEqual({
      action: 'list',
      businessId: IDS.business,
    });
  });

  it('el personal (staff) recibe un error legible', async () => {
    jwt = 'jwt-staff';
    await expect(
      new SupabaseProfessionalAdminRepository().list(IDS.business),
    ).rejects.toThrow(/owner o admin/);
  });
});

describe('sesión vencida', () => {
  it('un 401 con o sin código propio se reconoce para pedir un nuevo ingreso', async () => {
    const { isSessionExpired } =
      await import('../../../apps/web/src/professional/client');
    jwt = 'jwt-bad';
    expect(
      isSessionExpired(await fetchProfessionalCatalog().catch((e) => e)),
    ).toBe(true);
    // El gateway de Supabase rechaza un JWT vencido con 401 y sin `code` de texto.
    expect(isSessionExpired(new EdgeFunctionError('x', 401, null))).toBe(true);
    expect(
      isSessionExpired(new EdgeFunctionError('x', 403, 'not_professional')),
    ).toBe(false);
    expect(isSessionExpired(new Error('x'))).toBe(false);
  });
});
