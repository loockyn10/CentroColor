/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows and JSON bodies are untyped in tests. */
// Portal profesional de punta a punta: handlers reales → stores reales → migraciones reales
// (PGlite) → Drive emulado. El navegador y Google son los únicos dobles.
import { beforeEach, describe, expect, it } from 'vitest';
import { assertBusinessAdmin } from './authorization';
import { ApiError } from './http';
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
import { handlePublicOrderSubmit } from './public-order-handlers';
import { IDS, asRole } from './pg-harness';
import { C, U, seedProfessionalWorld } from './pg-professional-fixtures';
import { createPgServiceDb } from './pg-service-db';
import { createWorld, type World } from './pg-world';
import { jsonRequest } from './test-support';
import { handleUploadFinalize, handleUploadSession } from './upload-handlers';

const KEY = 'pro-client-key-aaaaaaaa';
const PHONE = '342 555 9999';

let w: World;
let lists: { public: string; professional: string; diego: string };
let variants: Record<string, string>;
const rows = async (sql: string, args: unknown[] = []) =>
  (await w.db.query<any>(sql, args)).rows;
/** Assigning a price list is an owner/admin action (a trigger enforces it), as in the panel. */
const assignList = (customerId: string, listId: string | null) =>
  asRole(w.db, 'authenticated', IDS.owner, () =>
    w.db.query(`update public.customers set price_list_id=$2 where id=$1`, [
      customerId,
      listId,
    ]),
  );

/** The signed-in browser: the verified user travels in a header the test `authenticate` reads. */
const deps = (): ProfessionalDeps => ({
  ...w.orderDeps,
  authenticate: async (request) => {
    const userId = request.headers.get('x-test-user');
    if (!userId)
      throw new ApiError('Autorización inválida.', 401, 'unauthorized');
    return { userId };
  },
});
const as = (userId: string | null) =>
  userId
    ? { Authorization: 'Bearer test', 'x-test-user': userId }
    : ({} as Record<string, string>);
const call = async (
  handler: (r: Request, d: any) => Promise<Response>,
  body: unknown,
  userId: string | null,
  d: unknown = deps(),
) => {
  const response = await handler(jsonRequest(body, as(userId)), d);
  return { status: response.status, body: (await response.json()) as any };
};
const catalog = (userId: string | null) =>
  call(handleProfessionalCatalog, {}, userId);
const start = (
  userId: string | null,
  overrides: Record<string, unknown> = {},
) =>
  call(
    handleProfessionalOrderStart,
    {
      clientKey: KEY,
      phone: PHONE,
      items: [
        {
          serviceId: IDS.svc10x15,
          variantId: variants.glossy10,
          quantity: 3,
        },
      ],
      ...overrides,
    },
    userId,
  );
const submit = (
  userId: string | null,
  token: string,
  extra: Record<string, unknown> = {},
) => call(handleProfessionalOrderSubmit, { token, ...extra }, userId);

/** The browser's part of one photo: session → bytes into the emulated Drive → finalize. */
async function upload(
  token: string,
  destinationId: string,
  name: string,
  copies = 1,
  previousUploadId?: string,
) {
  const session = await call(
    handleUploadSession,
    {
      token,
      destinationId,
      filename: name,
      mimeType: 'image/jpeg',
      sizeBytes: 12,
      copies,
      previousUploadId,
    },
    null,
    w.uploadDeps,
  );
  if (session.status !== 200 || session.body.alreadyUploaded)
    return { session, finalize: null };
  const row = (
    await rows(`select drive_file_id from public.photo_job_files where id=$1`, [
      session.body.uploadId,
    ])
  )[0];
  (w.google.files.find((x) => x.id === row.drive_file_id) as any).text =
    'x'.repeat(12);
  const finalize = await call(
    handleUploadFinalize,
    { token, uploadId: session.body.uploadId },
    null,
    w.uploadDeps,
  );
  return { session, finalize };
}
const dest = (started: any, serviceId: string) =>
  started.body.destinations.find((d: any) => d.serviceId === serviceId)
    .destinationId as string;

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
  ({ lists, variants } = await seedProfessionalWorld(w));
});

describe('acceso', () => {
  it('sin sesión no responde nada (ni precios)', async () => {
    const result = await call(handleProfessionalCatalog, {}, null);
    expect(result.status).toBe(401);
    expect(JSON.stringify(result.body)).not.toContain('30000');
  });

  it('un usuario autenticado que no es profesional recibe 403 y ningún precio', async () => {
    for (const user of [U.plain, IDS.owner, IDS.staff]) {
      const result = await catalog(user);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('not_professional');
      expect(JSON.stringify(result.body)).not.toContain('30000');
    }
  });

  it('una cuenta desactivada pierde el acceso al instante', async () => {
    await w.db.query(
      `update public.professional_accounts set is_active=false where user_id=$1`,
      [U.studio],
    );
    expect((await catalog(U.studio)).status).toBe(403);
    expect((await start(U.studio)).status).toBe(403);
  });

  it('el catálogo público sigue mostrando sólo la lista pública', async () => {
    const response = await (
      await import('./public-order-handlers')
    ).handlePublicCatalog(jsonRequest({}), w.orderDeps);
    const body = (await response.json()) as any;
    expect(JSON.stringify(body)).not.toContain('30000');
    expect(JSON.stringify(body)).not.toContain('Convenio');
    expect(body.services[0].unitPriceCents).toBe(50000);
  });
});

describe('lista de precios autorizada por el servidor', () => {
  it('Profesional: sus tramos y los formatos que tienen precio en esa lista', async () => {
    const { status, body } = await catalog(U.studio);
    expect(status).toBe(200);
    expect(body.account).toMatchObject({
      customerName: 'Estudio Luz',
      priceListName: 'Profesional',
      priceListUsable: true,
      paymentTerms: 'prepaid',
      phone: expect.stringContaining('342'),
    });
    expect(body.services.map((s: any) => [s.name, s.tiers])).toEqual([
      [
        '10x15 · Brillo',
        [
          { minQuantity: 1, maxQuantity: 99, unitPriceCents: 30000 },
          { minQuantity: 100, maxQuantity: null, unitPriceCents: 25000 },
        ],
      ],
      [
        '10x15 · Mate',
        [{ minQuantity: 1, maxQuantity: null, unitPriceCents: 32000 }],
      ],
      [
        '13x18 · Brillo',
        [{ minQuantity: 1, maxQuantity: null, unitPriceCents: 60000 }],
      ],
    ]);
  });

  it('Convenio Diego: su propia lista, sólo lo que tiene precio, y pago posterior', async () => {
    const { body } = await catalog(U.diego);
    expect(body.account).toMatchObject({
      customerName: 'Diego Fotógrafo',
      priceListName: 'Convenio Diego',
      paymentTerms: 'deferred',
    });
    expect(body.services).toHaveLength(1);
    expect(body.services[0]).toMatchObject({
      name: '10x15 · Brillo',
      unitPriceCents: 20000,
    });
    // Nada del convenio llega a otro profesional ni al público.
    expect(JSON.stringify((await catalog(U.studio)).body)).not.toContain(
      '20000',
    );
  });

  it('el navegador no puede elegir lista: un campo priceListId/customerId se ignora', async () => {
    const result = await start(U.studio, {
      priceListId: lists.diego,
      customerId: C.diego,
      items: [
        { serviceId: IDS.svc10x15, variantId: variants.glossy10, quantity: 2 },
      ],
    });
    expect(result.status).toBe(200);
    expect(result.body.destinations[0]).toMatchObject({
      unitPriceCents: 30000,
      totalCents: 60000,
    });
    const job = (
      await rows(
        `select j.customer_id, i.price_list_id from public.photo_jobs j
         join public.photo_job_items i on i.photo_job_id=j.id where i.is_active`,
      )
    )[0];
    expect(job).toEqual({
      customer_id: C.studio,
      price_list_id: lists.professional,
    });
  });

  it('un formato sin precio en su lista no se puede pedir (13×18 para Diego)', async () => {
    const result = await start(U.diego, {
      items: [
        { serviceId: IDS.svc13x18, variantId: variants.glossy13, quantity: 1 },
      ],
    });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('service_unavailable');
  });

  it('un cliente sin lista profesional no queda con el precio público: cuenta sin lista', async () => {
    await assignList(C.studio, null);
    const cat = await catalog(U.studio);
    expect(cat.body.account.priceListUsable).toBe(false);
    expect(cat.body.services).toEqual([]);
    const result = await start(U.studio);
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('no_professional_list');
    // Ni siquiera con la lista pública asignada explícitamente.
    await assignList(C.studio, lists.public);
    expect((await start(U.studio)).body.code).toBe('no_professional_list');
  });

  it('cambiar la lista del cliente cambia el portal de inmediato (convenio)', async () => {
    await assignList(C.studio, lists.diego);
    const { body } = await catalog(U.studio);
    expect(body.account.priceListName).toBe('Convenio Diego');
    expect(body.services.map((s: any) => s.unitPriceCents)).toEqual([20000]);
  });

  it('el total que vio el navegador sólo detecta listas viejas (price_changed)', async () => {
    const result = await start(U.studio, { expectedTotalCents: 1 });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('price_changed');
    expect((await start(U.studio, { expectedTotalCents: 90000 })).status).toBe(
      200,
    );
  });
});

describe('pedido grande (100+ fotos), tramos, copias y Drive', () => {
  it('120 fotos en dos formatos: precio por tramo, nombres con copias e integridad', async () => {
    // 10×15 Brillo: 90 fotos (60×1 + 30×2 = 120 copias → tramo 100+ a 250)
    // 10×15 Mate:   30 fotos × 1 copia = 30 → 320
    const started = await start(U.studio, {
      items: [
        {
          serviceId: IDS.svc10x15,
          variantId: variants.glossy10,
          quantity: 120,
        },
        {
          serviceId: variants.matte10,
          variantId: variants.matte10,
          quantity: 30,
        },
      ],
      expectedTotalCents: 120 * 25000 + 30 * 32000,
    });
    expect(started.status).toBe(200);
    expect(started.body.totalCents).toBe(120 * 25000 + 30 * 32000);
    expect(started.body.paymentTerms).toBe('prepaid');
    const token = started.body.uploadToken as string;
    const glossy = dest(started, IDS.svc10x15);
    const matte = dest(started, variants.matte10);

    const ids: string[] = [];
    for (let i = 1; i <= 90; i += 1) {
      const result = await upload(
        token,
        glossy,
        `IMG_${String(i).padStart(4, '0')}.jpg`,
        i <= 60 ? 1 : 2,
      );
      expect(result.finalize?.status).toBe(200);
      ids.push(result.session.body.uploadId);
    }
    for (let i = 1; i <= 30; i += 1) {
      const result = await upload(token, matte, `MATE_${i}.jpg`, 1);
      expect(result.finalize?.status).toBe(200);
      ids.push(result.session.body.uploadId);
    }

    const done = await submit(U.studio, token, {
      expectedFiles: { [glossy]: 90, [matte]: 30 },
      uploadIds: ids,
    });
    expect(done.status).toBe(200);
    expect(done.body.paymentTerms).toBe('prepaid');
    expect(done.body.totalCents).toBe(120 * 25000 + 30 * 32000);
    expect(done.body.items).toEqual([
      {
        name: '10x15 · Brillo · Profesional',
        quantity: 120,
        totalCents: 120 * 25000,
      },
      {
        name: '10x15 · Mate · Profesional',
        quantity: 30,
        totalCents: 30 * 32000,
      },
    ]);

    // Drive: una carpeta por formato y papel, archivos numerados con la cantidad final.
    const names = driveNames();
    expect(names).toHaveLength(120);
    expect(names).toContain('10x15 · Brillo · Profesional/001_1copia.jpg');
    expect(names).toContain('10x15 · Brillo · Profesional/061_2copias.jpg');
    expect(names).toContain('10x15 · Brillo · Profesional/090_2copias.jpg');
    expect(names).toContain('10x15 · Mate · Profesional/001_1copia.jpg');
    expect(names).toContain('10x15 · Mate · Profesional/030_1copia.jpg');
    // El nombre original queda en la base.
    const original = await rows(
      `select original_filename, stored_filename from public.photo_job_files
       where original_filename='IMG_0061.jpg'`,
    );
    expect(original).toEqual([
      { original_filename: 'IMG_0061.jpg', stored_filename: '061_2copias.jpg' },
    ]);
    // Un único árbol del pedido (sin carpetas duplicadas).
    const jobFolders = w.google.files.filter(
      (f) => f.mimeType === FOLDER && /^CC-[0-9A-F]{8} - /.test(f.name),
    );
    expect(jobFolders).toHaveLength(1);
    expect(jobFolders[0]!.name).toContain('Estudio Luz');
    // PEDIDO.txt declara el origen y la condición de pago.
    const manifest = w.google.files.find((f) => f.name === 'PEDIDO.txt') as any;
    expect(manifest.text).toContain('Pedido profesional (web)');
    expect(manifest.text).toContain('pago previo por transferencia');

    // Cobros reutiliza el pedido: facturado = total del pedido, sin duplicar contabilidad.
    const job = (
      await rows(
        `select j.is_draft, j.source_channel, j.notes, o.payment_terms,
                (select sum(total_cents) from public.photo_job_items where photo_job_id=j.id and is_active)::int total
         from public.photo_jobs j join public.public_photo_orders o on o.photo_job_id=j.id`,
      )
    )[0];
    expect(job).toMatchObject({
      is_draft: false,
      source_channel: 'public_web',
      payment_terms: 'prepaid',
      total: 120 * 25000 + 30 * 32000,
    });
    expect(job.notes).toContain('pago previo por transferencia');
  }, 120_000);

  it('más de 1000 copias en un tamaño: el portal profesional lo acepta, /imprimir no', async () => {
    const pro = await start(U.studio, {
      items: [
        {
          serviceId: IDS.svc10x15,
          variantId: variants.glossy10,
          quantity: 1500,
        },
      ],
    });
    expect(pro.status).toBe(200);
    expect(pro.body.destinations[0]).toMatchObject({
      quantity: 1500,
      unitPriceCents: 25000,
    });
    const publicStart = await call(
      (await import('./public-order-handlers')).handlePublicOrderStart,
      {
        clientKey: 'public-client-key-aaaa',
        customer: { name: 'María García', phone: '342 555 1234' },
        whatsappOptIn: true,
        items: [{ serviceId: IDS.svc10x15, quantity: 1500 }],
      },
      null,
      w.orderDeps,
    );
    expect(publicStart.status).toBe(400);
  });

  it('límites de carga: 1000 fotos y 300 MB para profesionales; 200 y 100 MB al público', async () => {
    const started = await start(U.studio);
    const token = started.body.uploadToken as string;
    const target = dest(started, IDS.svc10x15);
    const job = (
      await rows(`select photo_job_id from public.public_photo_orders`)
    )[0].photo_job_id;
    const item = (
      await rows(
        `select id from public.photo_job_items where photo_job_id=$1`,
        [job],
      )
    )[0].id;
    await w.db.query(
      `insert into public.photo_job_files(business_id,photo_job_id,photo_job_item_id,drive_file_id,drive_folder_id,
         original_filename,stored_filename,size_bytes,copies,workflow_route,status,created_at)
       select $1,$2,$3,'d'||g,'folder','a'||g||'.jpg','x'||g,10,1,'lab','uploaded',now()-interval '1 hour' from generate_series(1,250) g`,
      [IDS.business, job, item],
    );
    const big = (size: number) =>
      call(
        handleUploadSession,
        {
          token,
          destinationId: target,
          filename: 'grande.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: size,
          copies: 1,
        },
        null,
        w.uploadDeps,
      );
    // 250 ya cargadas: pasaría el tope público (200) pero no el profesional (1000).
    expect((await big(200 * 1024 * 1024)).status).toBe(200);
    expect((await big(301 * 1024 * 1024)).status).toBe(400);
    // El mismo caso en un pedido público se corta.
    const pub = await call(
      (await import('./public-order-handlers')).handlePublicOrderStart,
      {
        clientKey: 'public-client-key-bbbb',
        customer: { name: 'Ana', phone: '342 555 1111' },
        whatsappOptIn: true,
        items: [{ serviceId: IDS.svc10x15, quantity: 1 }],
      },
      null,
      w.orderDeps,
    );
    const pubJob = (
      await rows(
        `select photo_job_id from public.public_photo_orders where professional_account_id is null`,
      )
    )[0].photo_job_id;
    const pubItem = (
      await rows(
        `select id from public.photo_job_items where photo_job_id=$1`,
        [pubJob],
      )
    )[0].id;
    await w.db.query(
      `insert into public.photo_job_files(business_id,photo_job_id,photo_job_item_id,drive_file_id,drive_folder_id,
         original_filename,stored_filename,size_bytes,copies,workflow_route,status,created_at)
       select $1,$2,$3,'p'||g,'folder','a'||g||'.jpg','y'||g,10,1,'lab','uploaded',now()-interval '1 hour' from generate_series(1,200) g`,
      [IDS.business, pubJob, pubItem],
    );
    const refused = await call(
      handleUploadSession,
      {
        token: pub.body.uploadToken,
        destinationId: pub.body.destinations[0].destinationId,
        filename: 'x.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 12,
        copies: 1,
      },
      null,
      w.uploadDeps,
    );
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('too_many_files');
  }, 60_000);
});

describe('ritmo de carga', () => {
  it('un profesional puede abrir cientos de sesiones por minuto; el público no', async () => {
    const started = await start(U.studio);
    const token = started.body.uploadToken as string;
    const target = dest(started, IDS.svc10x15);
    const job = (
      await rows(`select photo_job_id from public.public_photo_orders`)
    )[0].photo_job_id;
    const item = (
      await rows(
        `select id from public.photo_job_items where photo_job_id=$1`,
        [job],
      )
    )[0].id;
    // 150 sesiones en el último minuto (por encima del tope público de 120).
    await w.db.query(
      `insert into public.photo_job_files(business_id,photo_job_id,photo_job_item_id,drive_file_id,drive_folder_id,
         original_filename,stored_filename,size_bytes,copies,workflow_route,status)
       select $1,$2,$3,'r'||g,'folder','a'||g||'.jpg','x'||g,10,1,'lab','uploaded' from generate_series(1,150) g`,
      [IDS.business, job, item],
    );
    const session = (t: string, d: string) =>
      call(
        handleUploadSession,
        {
          token: t,
          destinationId: d,
          filename: 'otra.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 12,
          copies: 1,
        },
        null,
        w.uploadDeps,
      );
    expect((await session(token, target)).status).toBe(200);

    const pub = await call(
      (await import('./public-order-handlers')).handlePublicOrderStart,
      {
        clientKey: 'public-client-key-cccc',
        customer: { name: 'Ana', phone: '342 555 1111' },
        whatsappOptIn: true,
        items: [{ serviceId: IDS.svc10x15, quantity: 1 }],
      },
      null,
      w.orderDeps,
    );
    const pubJob = (
      await rows(
        `select photo_job_id from public.public_photo_orders where professional_account_id is null`,
      )
    )[0].photo_job_id;
    const pubItem = (
      await rows(
        `select id from public.photo_job_items where photo_job_id=$1`,
        [pubJob],
      )
    )[0].id;
    await w.db.query(
      `insert into public.photo_job_files(business_id,photo_job_id,photo_job_item_id,drive_file_id,drive_folder_id,
         original_filename,stored_filename,size_bytes,copies,workflow_route,status)
       select $1,$2,$3,'q'||g,'folder','a'||g||'.jpg','y'||g,10,1,'lab','failed' from generate_series(1,120) g`,
      [IDS.business, pubJob, pubItem],
    );
    const refused = await session(
      pub.body.uploadToken,
      pub.body.destinations[0].destinationId,
    );
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('rate_limited');
  }, 60_000);
});

describe('reintentos, fallos parciales y duplicados', () => {
  it('reintentar una foto que ya llegó no la duplica, y actualiza sus copias', async () => {
    const started = await start(U.studio);
    const token = started.body.uploadToken as string;
    const target = dest(started, IDS.svc10x15);
    const first = await upload(token, target, 'A.jpg', 1);
    const retry = await upload(
      token,
      target,
      'A.jpg',
      4,
      first.session.body.uploadId,
    );
    expect(retry.session.body).toMatchObject({
      alreadyUploaded: true,
      uploadId: first.session.body.uploadId,
    });
    const files = await rows(
      `select copies, status from public.photo_job_files where original_filename='A.jpg'`,
    );
    expect(files).toEqual([{ copies: 4, status: 'uploaded' }]);
    const done = await submit(U.studio, token, {
      expectedFiles: { [target]: 1 },
      uploadIds: [first.session.body.uploadId],
    });
    expect(done.status).toBe(200);
    expect(done.body.items[0]).toMatchObject({
      quantity: 4,
      totalCents: 4 * 30000,
    });
    expect(driveNames()).toEqual([
      '10x15 · Brillo · Profesional/001_4copias.jpg',
    ]);
  });

  it('con una foto sin terminar no se confirma; faltantes se informan y sólo se envía sin ellas si se acepta', async () => {
    const started = await start(U.studio, {
      items: [
        { serviceId: IDS.svc10x15, variantId: variants.glossy10, quantity: 3 },
        { serviceId: IDS.svc13x18, variantId: variants.glossy13, quantity: 2 },
      ],
    });
    const token = started.body.uploadToken as string;
    const ten = dest(started, IDS.svc10x15);
    const eighteen = dest(started, IDS.svc13x18);
    const a = await upload(token, ten, 'A.jpg', 2);
    // Sesión abierta y nunca finalizada = foto a medio subir.
    const half = await call(
      handleUploadSession,
      {
        token,
        destinationId: ten,
        filename: 'B.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 12,
        copies: 1,
      },
      null,
      w.uploadDeps,
    );
    expect((await submit(U.studio, token)).body.code).toBe('uploads_pending');

    // La foto que falló se marca fallida (el reintento la reemplaza) y 13×18 nunca llegó.
    await w.db.query(
      `update public.photo_job_files set status='failed' where id=$1`,
      [half.body.uploadId],
    );
    const incomplete = await submit(U.studio, token, {
      expectedFiles: { [ten]: 2, [eighteen]: 1 },
      uploadIds: [a.session.body.uploadId],
    });
    expect(incomplete.status).toBe(409);
    expect(incomplete.body.code).toBe('order_incomplete');

    const retried = await upload(token, ten, 'B.jpg', 1, half.body.uploadId);
    expect(retried.finalize?.status).toBe(200);
    const partial = await submit(U.studio, token, {
      expectedFiles: { [ten]: 2, [eighteen]: 1 },
      uploadIds: [a.session.body.uploadId, retried.session.body.uploadId],
      acceptPartial: true,
    });
    expect(partial.status).toBe(200);
    // 13×18 se descarta (sin fotos) y no se factura.
    expect(partial.body.items).toEqual([
      {
        name: '10x15 · Brillo · Profesional',
        quantity: 3,
        totalCents: 3 * 30000,
      },
    ]);
    expect(driveNames()).toEqual([
      '10x15 · Brillo · Profesional/001_2copias.jpg',
      '10x15 · Brillo · Profesional/002_1copia.jpg',
    ]);
  });

  it('confirmar dos veces no duplica el pedido', async () => {
    const started = await start(U.studio);
    const token = started.body.uploadToken as string;
    await upload(token, dest(started, IDS.svc10x15), 'A.jpg', 1);
    const first = await submit(U.studio, token);
    const again = await submit(U.studio, token);
    expect(again.status).toBe(200);
    expect(again.body.alreadySubmitted).toBe(true);
    expect(first.body.totalCents).toBe(again.body.totalCents);
    expect(
      (
        await rows(
          `select count(*)::int n from public.photo_jobs where source_channel='public_web'`,
        )
      )[0].n,
    ).toBe(1);
  });

  it('repetir el inicio con la misma clave reutiliza el borrador', async () => {
    const a = await start(U.studio);
    const b = await start(U.studio, {
      items: [
        { serviceId: IDS.svc10x15, variantId: variants.glossy10, quantity: 5 },
      ],
    });
    expect(a.body.orderCode).toBe(b.body.orderCode);
    expect(b.body.totalCents).toBe(5 * 30000);
    expect(
      (await rows(`select count(*)::int n from public.photo_jobs`))[0].n,
    ).toBe(1);
  });
});

describe('aislamiento entre cuentas y con el público', () => {
  it('otra cuenta (aunque tenga el token) no puede confirmar ni ver el pedido', async () => {
    const started = await start(U.studio);
    const token = started.body.uploadToken as string;
    await upload(token, dest(started, IDS.svc10x15), 'A.jpg', 1);
    expect((await submit(U.diego, token)).status).toBe(404);
    expect((await submit(U.plain, token)).status).toBe(403);
    expect((await submit(null, token)).status).toBe(401);
    // El endpoint público tampoco cierra pedidos profesionales con ese token.
    const viaPublic = await call(
      handlePublicOrderSubmit,
      { token },
      null,
      w.orderDeps,
    );
    expect(viaPublic.status).toBe(404);
    expect(
      (await rows(`select status from public.public_photo_orders`))[0].status,
    ).toBe('draft');
    expect((await submit(U.studio, token)).status).toBe(200);
  });

  it('una clave de pedido ajena no se puede secuestrar', async () => {
    await start(U.studio);
    const stolen = await start(U.diego);
    expect(stolen.status).toBe(400);
    expect(
      (await rows(`select count(*)::int n from public.photo_jobs`))[0].n,
    ).toBe(1);
  });

  it('dos usuarios del mismo cliente comparten lista, pero cada uno su cuenta', async () => {
    await asRole(w.db, 'service_role', null, () =>
      w.db.query(`select public.cc_professional_link($1,$2,$3,false,$4)`, [
        IDS.business,
        U.assistant,
        C.studio,
        IDS.owner,
      ]),
    );
    expect((await catalog(U.assistant)).body.account.customerName).toBe(
      'Estudio Luz',
    );
    const a = await start(U.studio);
    expect((await submit(U.assistant, a.body.uploadToken)).status).toBe(404);
  });

  it('una cuenta profesional no entra al panel: RLS no le devuelve ni una fila', async () => {
    const started = await start(U.studio);
    expect(started.status).toBe(200);
    const visible = await asRole(w.db, 'authenticated', U.studio, async () => {
      const count = async (table: string) =>
        Number(
          (await w.db.query<any>(`select count(*)::int n from public.${table}`))
            .rows[0].n,
        );
      return {
        customers: await count('customers'),
        photoJobs: await count('photo_jobs'),
        items: await count('photo_job_items'),
        orders: await count('public_photo_orders'),
        memberships: await count('business_memberships'),
        businesses: await count('businesses'),
        priceLists: await count('price_lists'),
        tiers: await count('lab_price_tiers'),
      };
    });
    expect(Object.values(visible).every((n) => n === 0)).toBe(true);
    // Y no puede leer ni tocar la tabla de cuentas.
    await expect(
      asRole(w.db, 'authenticated', U.studio, () =>
        w.db.query(`select * from public.professional_accounts`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(w.db, 'authenticated', U.studio, () =>
        w.db.query(
          `update public.professional_accounts set allow_deferred_payment=true`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('nadie es profesional y miembro a la vez (en ninguno de los dos sentidos)', async () => {
    await expect(
      asRole(w.db, 'service_role', null, () =>
        w.db.query(`select public.cc_professional_link($1,$2,$3,false,$4)`, [
          IDS.business,
          IDS.staff,
          C.studio,
          IDS.owner,
        ]),
      ),
    ).rejects.toThrow(/cc_error:user_is_member/);
    await expect(
      w.db.query(
        `insert into public.business_memberships(business_id,user_id,role) values($1,$2,'staff')`,
        [IDS.business, U.studio],
      ),
    ).rejects.toThrow(/cc_error:user_is_professional/);
  });
});

describe('una cuenta profesional no administra nada ni toca su lista', () => {
  const asPro = <T>(work: () => Promise<T>) =>
    asRole(w.db, 'authenticated', U.studio, work);

  it('no puede cambiar su lista de precios ni la de nadie, ni tocar clientes, precios o su condición de pago', async () => {
    await start(U.studio);
    const attempts = await asPro(async () => {
      const run = async (sql: string) =>
        w.db.query(sql).then(
          (r) => `ok:${r.affectedRows ?? 0}`,
          (e) => `error:${(e as Error).message}`,
        );
      return {
        ownList: await run(
          `update public.customers set price_list_id='${lists.public}' where id='${C.studio}'`,
        ),
        otherList: await run(
          `update public.customers set price_list_id='${lists.diego}'`,
        ),
        newCustomer: await run(
          `insert into public.customers(business_id,full_name) values('${IDS.business}','Falso')`,
        ),
        itemPrice: await run(
          `update public.photo_job_items set unit_price_cents=1`,
        ),
        tier: await run(`update public.lab_price_tiers set unit_price_cents=1`),
        deferred: await run(
          `update public.professional_accounts set allow_deferred_payment=true`,
        ),
        order: await run(
          `update public.public_photo_orders set payment_terms='deferred'`,
        ),
      };
    });
    // Nada se modificó: 0 filas (RLS) o permiso denegado.
    for (const outcome of Object.values(attempts))
      expect(outcome).toMatch(
        /^(ok:0|error:.*(permission denied|row-level security))/,
      );
    expect(
      (
        await rows(`select price_list_id from public.customers where id=$1`, [
          C.studio,
        ])
      )[0].price_list_id,
    ).toBe(lists.professional);
    expect(
      (
        await rows(
          `select allow_deferred_payment from public.professional_accounts where user_id=$1`,
          [U.studio],
        )
      )[0].allow_deferred_payment,
    ).toBe(false);
    expect(
      (await rows(`select payment_terms from public.public_photo_orders`))[0]
        .payment_terms,
    ).toBe('prepaid');
  });

  it('no puede ejecutar las funciones internas cc_* ni las de cobros, ventas y stock', async () => {
    const reachable = (
      await rows(
        `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and has_function_privilege('authenticated', p.oid, 'execute')
           and has_function_privilege('anon', p.oid, 'execute') = false
         order by 1`,
      )
    ).map((x) => x.proname);
    // Lista cerrada: una función nueva con EXECUTE para `authenticated` obliga a revisarla aquí.
    expect(reachable).toEqual([
      'apply_stock_movement',
      'complete_pos_sale',
      'post_work_payment',
      'record_stock_change',
      'void_work_payment',
    ]);
    expect(
      (
        await rows(
          `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')`,
        )
      ).length,
    ).toBe(0);
    // Esas cinco exigen membership: con una cuenta profesional todas fallan.
    const call = (sql: string) =>
      asPro(() => w.db.query(sql)).then(
        () => 'ok',
        (e) => (e as Error).message,
      );
    const payload = JSON.stringify({
      business_id: IDS.business,
      created_by: U.studio,
      source_type: 'photo_job',
      source_id: C.studio,
      amount_cents: 100,
    });
    const results = [
      await call(`select public.post_work_payment('${payload}'::jsonb)`),
      await call(
        `select public.void_work_payment('${IDS.business}','${C.studio}','x')`,
      ),
      await call(
        `select public.complete_pos_sale('${payload}'::jsonb, '[{}]'::jsonb)`,
      ),
      await call(`select public.apply_stock_movement('${payload}'::jsonb)`),
      await call(
        `select public.record_stock_change('${C.studio}','${IDS.business}','${IDS.branch}','${C.studio}','entry',1,null)`,
      ),
    ];
    expect(results.every((message) => message !== 'ok')).toBe(true);
    for (const rpc of [
      `select public.cc_professional_link('${IDS.business}','${U.studio}','${C.retail}',true,null)`,
      `select public.cc_professional_update('${IDS.business}','${U.studio}',true,true)`,
      `select public.cc_professional_context('${U.studio}')`,
      `select public.cc_auth_user_by_email('estudio@example.com')`,
      `select public.cc_public_order_confirm('${IDS.business}','${C.studio}','${C.studio}','x',now())`,
    ])
      expect(await call(rpc)).toMatch(/permission denied/);
  });

  it('con su JWT las funciones de administración no lo reconocen: ni membership ni rol', async () => {
    const membership = await asPro(
      async () =>
        (
          await w.db.query<any>(
            `select business_id,user_id,role,is_active from public.business_memberships where user_id='${U.studio}'`,
          )
        ).rows[0] ?? null,
    );
    expect(membership).toBeNull();
    expect(() =>
      assertBusinessAdmin(U.studio, IDS.business, membership),
    ).toThrow(/owner o admin/);
    // El mismo chequeo que usa authenticateAdmin en profesional-admin, photo-file-admin y whatsapp-admin.
    const result = await call(
      handleProfessionalAdmin as (r: Request, d: any) => Promise<Response>,
      {
        action: 'update',
        businessId: IDS.business,
        accountId: C.studio,
        allowDeferredPayment: true,
      },
      U.studio,
      {
        authenticate: async (_request: Request, businessId: string) => {
          assertBusinessAdmin(U.studio, businessId, membership);
          return { user: { id: U.studio }, membership };
        },
        store: () => createProfessionalAdminStore(createPgServiceDb(w.db)),
        inviteUser: async () => 'x',
        getEnv: () => undefined,
        logger: w.logger,
      },
    );
    expect(result.status).toBe(403);
  });
});

describe('pago posterior', () => {
  it('sólo con autorización de CentroColor: se decide en el servidor y queda en el pedido', async () => {
    const studio = await start(U.studio);
    expect(studio.body.paymentTerms).toBe('prepaid');
    const diego = await call(
      handleProfessionalOrderStart,
      {
        clientKey: 'diego-client-key-aaaa',
        phone: PHONE,
        items: [
          {
            serviceId: IDS.svc10x15,
            variantId: variants.glossy10,
            quantity: 2,
          },
        ],
        // Un navegador que pretende lo contrario no cambia nada.
        paymentTerms: 'prepaid',
        allowDeferredPayment: false,
      },
      U.diego,
    );
    expect(diego.body.paymentTerms).toBe('deferred');
    const forged = await start(U.studio, {
      clientKey: 'studio-client-key-bbbb',
      paymentTerms: 'deferred',
      allowDeferredPayment: true,
    });
    expect(forged.body.paymentTerms).toBe('prepaid');

    const done = await call(
      handleProfessionalOrderSubmit,
      { token: diego.body.uploadToken },
      U.diego,
    );
    expect(done.status).toBe(409); // todavía sin fotos: no se confirma vacío
    const target = diego.body.destinations[0].destinationId;
    await upload(diego.body.uploadToken, target, 'A.jpg', 2);
    const ok = await call(
      handleProfessionalOrderSubmit,
      { token: diego.body.uploadToken, expectedFiles: { [target]: 1 } },
      U.diego,
    );
    expect(ok.body.paymentTerms).toBe('deferred');
    const manifest = w.google.files.find((f) => f.name === 'PEDIDO.txt') as any;
    expect(manifest.text).toContain('pago posterior autorizado');
    const stored = await rows(
      `select o.payment_terms, j.notes from public.public_photo_orders o
       join public.photo_jobs j on j.id=o.photo_job_id where o.client_key='diego-client-key-aaaa'`,
    );
    expect(stored[0].payment_terms).toBe('deferred');
    expect(stored[0].notes).toContain('pago posterior autorizado');
    // El personal ve la condición (columna permitida), nunca la cuenta.
    const staffView = await asRole(w.db, 'authenticated', IDS.staff, () =>
      w.db.query<any>(
        `select payment_terms from public.public_photo_orders where status='submitted'`,
      ),
    );
    expect(staffView.rows).toEqual([{ payment_terms: 'deferred' }]);
    await expect(
      asRole(w.db, 'authenticated', IDS.staff, () =>
        w.db.query(
          `select professional_account_id from public.public_photo_orders`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('revocar la autorización se aplica al siguiente pedido', async () => {
    await w.db.query(
      `update public.professional_accounts set allow_deferred_payment=false where user_id=$1`,
      [U.diego],
    );
    expect((await catalog(U.diego)).body.account.paymentTerms).toBe('prepaid');
    expect(
      (await start(U.diego, { clientKey: 'diego-client-key-cccc' })).body
        .paymentTerms,
    ).toBe('prepaid');
  });
});

describe('administración de cuentas (owner/admin)', () => {
  const invited: string[] = [];
  const adminDeps = (invitedId = '92000000-0000-4000-8000-000000000001') => ({
    authenticate: async (request: Request, businessId: string) => {
      const userId = request.headers.get('x-test-user');
      const membership = (
        await rows(
          `select business_id,user_id,role,is_active from public.business_memberships where user_id=$1`,
          [userId ?? null],
        )
      )[0];
      assertBusinessAdmin(userId!, businessId, membership ?? null);
      return { user: { id: userId! }, membership };
    },
    store: () => createProfessionalAdminStore(createPgServiceDb(w.db)),
    inviteUser: async (email: string, redirectTo: string) => {
      invited.push(`${email}|${redirectTo}`);
      await w.db.query(`insert into auth.users(id,email) values($1,$2)`, [
        invitedId,
        email,
      ]);
      return invitedId;
    },
    logger: w.logger,
    getEnv: (name: string) =>
      ({
        PHOTO_UPLOAD_SIGNING_SECRET:
          'unit-test-signing-secret-0123456789abcdef',
        PUBLIC_WEB_URL: 'https://centro-color-web.vercel.app',
        GOOGLE_DRIVE_CLIENT_ID: 'x',
        GOOGLE_DRIVE_CLIENT_SECRET: 'x',
      })[name],
  });
  const admin = (
    userId: string | null,
    body: Record<string, unknown>,
    d = adminDeps(),
  ) =>
    call(
      handleProfessionalAdmin as (r: Request, d: any) => Promise<Response>,
      { businessId: IDS.business, ...body },
      userId,
      d,
    );

  beforeEach(() => {
    invited.length = 0;
  });

  it('lista las cuentas con cliente, lista de precios y condición de pago', async () => {
    const result = await admin(IDS.owner, { action: 'list' });
    expect(result.status).toBe(200);
    expect(
      result.body.accounts.map((a: any) => [
        a.email,
        a.customer_name,
        a.price_list_name,
        a.allow_deferred_payment,
      ]),
    ).toEqual([
      ['diego@example.com', 'Diego Fotógrafo', 'Convenio Diego', true],
      ['estudio@example.com', 'Estudio Luz', 'Profesional', false],
    ]);
  });

  it('el personal (staff) no puede administrar cuentas, ni sin sesión', async () => {
    expect((await admin(IDS.staff, { action: 'list' })).status).toBe(403);
    expect((await admin(null, { action: 'list' })).status).toBe(401);
    expect(
      (
        await admin(IDS.staff, {
          action: 'update',
          accountId: U.studio,
          isActive: false,
        })
      ).status,
    ).toBe(403);
  });

  it('un owner de otro negocio no administra las cuentas de este', async () => {
    expect((await admin(IDS.outsider, { action: 'list' })).status).toBe(403);
  });

  it('vincula un usuario existente sin invitar a nadie', async () => {
    await assignList(C.retail, lists.professional);
    const result = await admin(IDS.owner, {
      action: 'link',
      email: ' Sin-Cuenta@Example.com ',
      customerId: C.retail,
      allowDeferredPayment: true,
    });
    expect(result.status).toBe(200);
    expect(result.body.invited).toBe(false);
    expect(invited).toEqual([]);
    const account = result.body.accounts.find(
      (a: any) => a.email === 'sin-cuenta@example.com',
    );
    expect(account).toMatchObject({
      customer_name: 'Cliente de mostrador',
      allow_deferred_payment: true,
      is_active: true,
    });
    expect((await catalog(U.plain)).body.account.paymentTerms).toBe('deferred');
  });

  it('invita por e-mail al usuario que todavía no existe', async () => {
    const result = await admin(IDS.owner, {
      action: 'link',
      email: 'nuevo@example.com',
      customerId: C.studio,
    });
    expect(result.status).toBe(200);
    expect(result.body.invited).toBe(true);
    expect(invited).toEqual([
      'nuevo@example.com|https://centro-color-web.vercel.app/profesionales',
    ]);
    expect(result.body.accounts.map((a: any) => a.email)).toContain(
      'nuevo@example.com',
    );
  });

  it('un cliente sin lista Profesional/convenio no recibe acceso y no se invita a nadie', async () => {
    const result = await admin(IDS.owner, {
      action: 'link',
      email: 'otro@example.com',
      customerId: C.retail,
    });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('price_list_required');
    expect(invited).toEqual([]);
  });

  it('no vincula a una persona del equipo ni a un e-mail ya vinculado a otro cliente', async () => {
    const member = await admin(IDS.owner, {
      action: 'link',
      email: 'staff@example.com',
      customerId: C.studio,
    });
    expect(member.status).toBe(409);
    expect(member.body.code).toBe('user_is_member');
    const taken = await admin(IDS.owner, {
      action: 'link',
      email: 'diego@example.com',
      customerId: C.studio,
    });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('already_linked');
  });

  it('desactiva y reactiva una cuenta, y cambia el pago posterior', async () => {
    const id = (await admin(IDS.owner, { action: 'list' })).body.accounts.find(
      (a: any) => a.email === 'estudio@example.com',
    ).id;
    const off = await admin(IDS.owner, {
      action: 'update',
      accountId: id,
      isActive: false,
    });
    expect(off.body.accounts.find((a: any) => a.id === id).is_active).toBe(
      false,
    );
    expect((await catalog(U.studio)).status).toBe(403);
    const on = await admin(IDS.owner, {
      action: 'update',
      accountId: id,
      isActive: true,
      allowDeferredPayment: true,
    });
    expect(on.body.accounts.find((a: any) => a.id === id)).toMatchObject({
      is_active: true,
      allow_deferred_payment: true,
    });
    expect((await catalog(U.studio)).body.account.paymentTerms).toBe(
      'deferred',
    );
  });

  it('valida la entrada', async () => {
    expect(
      (
        await admin(IDS.owner, {
          action: 'link',
          email: 'no-es-mail',
          customerId: C.studio,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin(IDS.owner, {
          action: 'link',
          email: 'a@b.co',
          customerId: 'x',
        })
      ).status,
    ).toBe(400);
    expect((await admin(IDS.owner, { action: 'borrar' })).status).toBe(400);
  });
});
