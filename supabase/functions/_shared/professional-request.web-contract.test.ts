/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies and PostgREST rows are untyped here. */
// /profesionales sin cuenta, código del navegador ↔ backend, con código real de los dos lados: el
// cliente Web anónimo, el modelo (carpetas, copias, líneas) y la coreografía de subida compartida con
// /imprimir corren contra los handlers, los stores y las migraciones reales (PGlite).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchProfessionalPublicCatalog,
  startProfessionalRequest,
  submitProfessionalRequest,
} from '../../../apps/web/src/professional/client';
import {
  applyCopiesToAll,
  classifyPickedFiles,
  missingForRequestConfirm,
  planAdditions,
  REQUEST_LIMITS,
  startRequestBody,
} from '../../../apps/web/src/professional/model';
import { trackOrder } from '../../../apps/web/src/public-order/client';
import { deriveLines } from '../../../apps/web/src/public-order/model';
import { catalogSizes } from '../../../apps/web/src/public-order/order-blocks';
import {
  buildSubmitOptions,
  sendEntries,
  type UploadProgress,
} from '../../../apps/web/src/public-order/order-submission';
import {
  handleProfessionalPublicCatalog,
  handleProfessionalRequestStart,
  handleProfessionalRequestSubmit,
} from './professional-request-handlers';
import { handlePublicOrderTrack } from './public-order-handlers';
import { seedProfessionalWorld } from './pg-professional-fixtures';
import { createWorld, type World } from './pg-world';
import { handleUploadFinalize, handleUploadSession } from './upload-handlers';

let w: World;
const PRICES = ['30000', '25000', '32000', '60000', '20000', '50000', '80000'];

// The anonymous page never creates a Supabase client: any attempt would be a bug of this flow.
vi.mock('../../../apps/web/src/cloud-config', () => ({
  getSupabaseClient: () => {
    throw new Error('el flujo anónimo no usa la sesión');
  },
}));

/** Every response body the browser received, to prove no price ever travelled. */
const received: string[] = [];

function installNetwork(options: { failSession?: Set<string> } = {}) {
  const urlToUpload = new Map<string, string>();
  const authHeaders: (string | null)[] = [];
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
      authHeaders.push(request.headers.get('x-test-user'));
      const route = async () => {
        if (name === 'professional-public-catalog')
          return handleProfessionalPublicCatalog(request, w.orderDeps);
        if (name === 'professional-request-start')
          return handleProfessionalRequestStart(request, w.orderDeps);
        if (name === 'professional-request-submit')
          return handleProfessionalRequestSubmit(request, w.orderDeps);
        if (name === 'public-photo-order-track')
          return handlePublicOrderTrack(request, w.orderDeps);
        if (name === 'photo-upload-session') {
          const body = await request.clone().json();
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
          return handleUploadFinalize(request, w.uploadDeps);
        throw new Error(`unrouted ${name}`);
      };
      const response = await route();
      received.push(await response.clone().text());
      return response;
    }),
  );
  return { authHeaders };
}

const photo = (name: string, bytes = 20) =>
  new File(['x'.repeat(bytes)], name, { type: 'image/jpeg', lastModified: 1 });
const FOLDER = 'application/vnd.google-apps.folder';
const driveNames = () => {
  const byId = new Map(w.google.files.map((f) => [f.id, f]));
  const path = (id: string) => {
    const names: string[] = [];
    for (let n = byId.get(id); n; n = byId.get(n.parents[0]!))
      names.unshift(n.name);
    return names
      .join('/')
      .replace(/^.*?CC-[0-9A-F]{8} - [^/]+\//, '')
      .replace(/^Para imprimir\//, '');
  };
  return w.google.files
    .filter(
      (f) => !f.trashed && f.mimeType !== FOLDER && f.name !== 'PEDIDO.txt',
    )
    .map((f) => path(f.id))
    .sort();
};

beforeEach(async () => {
  w = await createWorld();
  await seedProfessionalWorld(w);
  received.length = 0;
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('/profesionales sin cuenta: cliente web ↔ funciones reales', () => {
  it('carpeta de 120 fotos sin sesión: ninguna respuesta lleva un precio, reintenta sólo las fallidas y Drive conserva las copias', async () => {
    const network = installNetwork({ failSession: new Set(['IMG_7.jpg']) });
    const catalog = await fetchProfessionalPublicCatalog();
    expect(catalog.account).toBeNull();
    const sizes = catalogSizes(catalog.services);
    expect(sizes.map((s) => [s.name, s.papers.map((p) => p.label)])).toEqual([
      ['10x15', ['Brillo', 'Mate']],
      ['13x18', ['Brillo']],
      // Publicado también en /imprimir: un tamaño público se puede pedir como profesional.
      ['20x30', ['Brillo']],
    ]);
    const glossy = sizes[0]!.papers[0]!.service.id;
    const matte = sizes[0]!.papers[1]!.service.id;

    // La carpeta de Lightroom: 120 fotos + archivos que no son fotos.
    const folder = [
      ...Array.from({ length: 120 }, (_, i) => photo(`IMG_${i + 1}.jpg`)),
      new File(['x'], 'Boda.lrcat'),
      new File(['x'], '.DS_Store'),
    ];
    const picked = classifyPickedFiles(folder, REQUEST_LIMITS.bytes);
    expect(picked.accepted).toHaveLength(120);
    expect(picked.ignored).toBe(2);
    let entries = planAdditions([], glossy, picked.accepted, {
      max: REQUEST_LIMITS.files,
    }).entries;
    entries = [
      ...entries,
      ...planAdditions(entries, matte, picked.accepted.slice(0, 5), {
        max: REQUEST_LIMITS.files,
      }).entries,
    ];
    entries = applyCopiesToAll(entries, glossy, 2).map((e, i) =>
      e.serviceId === glossy && i === 0 ? { ...e, copies: 5 } : e,
    );
    const selected = [glossy, matte];
    const lines = deriveLines(catalog.services, selected, entries);
    expect(lines.map((l) => [l.files, l.copies])).toEqual([
      [120, 5 + 119 * 2],
      [5, 5],
    ]);

    // Sin nombre y teléfono no se puede enviar; con ellos, sí.
    expect(
      missingForRequestConfirm(lines, selected, {
        name: '',
        phone: '',
        email: '',
      }),
    ).toEqual(['tu nombre', 'tu teléfono']);
    const contact = {
      name: 'Lucía Fotógrafa',
      phone: '342 555 7777',
      email: '',
    };
    expect(missingForRequestConfirm(lines, selected, contact)).toEqual([]);

    // El cuerpo no lleva ningún dato de precio, total, lista ni cliente.
    const body = startRequestBody(
      'web-request-key-aaaaaaaa',
      contact,
      '',
      lines,
    );
    expect(JSON.stringify(body)).not.toMatch(
      /price|total|list|customerId|expected/i,
    );
    const started = await startProfessionalRequest(body);
    expect(started.destinations.map((d) => d.quantity)).toEqual([243, 5]);

    const attempts = new Map<string, string>();
    const progress = new Map<string, UploadProgress>();
    const sendAll = (targets: typeof entries) =>
      sendEntries({
        started,
        entries: targets,
        attempts,
        concurrency: 4,
        onProgress: (id, p) => progress.set(id, p),
      });
    // IMG_7 falla en el primer intento: sólo esa se reintenta, el resto no se vuelve a enviar.
    expect(await sendAll(entries)).toBe(1);
    const failed = entries.filter(
      (e) => progress.get(e.id)?.status === 'failed',
    );
    expect(failed.map((e) => e.file.name)).toEqual(['IMG_7.jpg']);
    vi.unstubAllGlobals();
    installNetwork();
    expect(await sendAll(failed)).toBe(0);

    const done = await submitProfessionalRequest(
      started.uploadToken,
      buildSubmitOptions({ started, selected, sent: entries, attempts }),
    );
    expect(done).toMatchObject({ status: 'received', quote: 'pending' });
    expect(done.items).toEqual([
      { name: '10x15 · Brillo', quantity: 243 },
      { name: '10x15 · Mate', quantity: 5 },
    ]);

    // Ninguna de las respuestas que recibió el navegador contiene un solo precio.
    for (const text of received) {
      for (const price of PRICES) expect(text).not.toContain(price);
      expect(text).not.toMatch(/unitPrice|totalCents|tiers|Convenio/);
    }

    // El seguimiento tampoco muestra importes.
    const tracked = await trackOrder(done.trackingToken);
    expect(tracked.request).toEqual({ quote: 'pending' });
    expect(tracked.totalCents).toBeUndefined();
    expect(tracked.items.every((i) => i.totalCents === undefined)).toBe(true);

    // Drive: una carpeta por formato y papel; el nombre lleva la cantidad definitiva de copias.
    const names = driveNames();
    expect(names).toHaveLength(125);
    expect(names).toContain(
      '10x15 · Brillo · Por presupuestar/001_5copias.jpg',
    );
    expect(names).toContain(
      '10x15 · Brillo · Por presupuestar/002_2copias.jpg',
    );
    expect(names).toContain(
      '10x15 · Brillo · Por presupuestar/120_2copias.jpg',
    );
    expect(names).toContain('10x15 · Mate · Por presupuestar/005_1copia.jpg');
    // El pedido queda pendiente de presupuestar, sin importe y sin pagos.
    const job = (
      await w.db.query<any>(
        `select quote_status, (select coalesce(sum(total_cents),0)::int from public.photo_job_items where photo_job_id=j.id) total,
                (select count(*)::int from public.work_payments) payments
         from public.photo_jobs j`,
      )
    ).rows[0];
    expect(job).toEqual({
      quote_status: 'pending_quote',
      total: 0,
      payments: 0,
    });
    // Nunca envió una sesión de usuario.
    expect(network.authHeaders.every((h) => h === null)).toBe(true);
  }, 180_000);

  it('el límite de 500 fotos del pedido anónimo se aplica en el navegador y en el servidor', async () => {
    const files = Array.from({ length: 520 }, (_, i) => photo(`P_${i}.jpg`));
    const added = planAdditions([], 'svc', files, {
      max: REQUEST_LIMITS.files,
    });
    expect(added.entries).toHaveLength(500);
    expect(added.overflow).toBe(20);
    // 101 MB por foto: el navegador la descarta (el servidor también la rechazaría).
    const big = classifyPickedFiles(
      [
        Object.defineProperty(photo('grande.jpg'), 'size', {
          value: 101 * 1024 * 1024,
        }),
      ],
      REQUEST_LIMITS.bytes,
    );
    expect(big.tooLarge).toEqual(['grande.jpg']);
    expect(big.accepted).toHaveLength(0);
  });
});
