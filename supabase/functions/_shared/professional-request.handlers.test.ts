/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows and JSON bodies are untyped in tests. */
// /profesionales sin cuenta: handlers reales → stores reales → migraciones reales (PGlite) → Drive
// emulado. Verifica que un visitante anónimo envía fotos sin ver un solo precio, que el pedido queda
// pendiente de presupuestar (nunca gratis ni pagado) y que CentroColor lo presupuesta desde el servidor.
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from './http';
import {
  handleProfessionalCatalog,
  handleProfessionalOrderStart,
  type ProfessionalDeps,
} from './professional-handlers';
import {
  handleProfessionalPublicCatalog,
  handleProfessionalRequestStart,
  handleProfessionalRequestSubmit,
} from './professional-request-handlers';
import {
  handlePublicOrderStart,
  handlePublicOrderSubmit,
  handlePublicOrderTrack,
} from './public-order-handlers';
import { IDS, asRole } from './pg-harness';
import { C, U, seedProfessionalWorld } from './pg-professional-fixtures';
import { createWorld, type World } from './pg-world';
import { jsonRequest } from './test-support';
import { handleUploadFinalize, handleUploadSession } from './upload-handlers';

const KEY = 'request-client-key-aaaa';
const PHONE = '342 555 7777';

let w: World;
let lists: { public: string; professional: string; diego: string };
let variants: Record<string, string>;
const rows = async (sql: string, args: unknown[] = []) =>
  (await w.db.query<any>(sql, args)).rows;

const call = async (
  handler: (r: Request, d: any) => Promise<Response>,
  body: unknown,
  headers: Record<string, string> = {},
  d: unknown = w.orderDeps,
) => {
  const response = await handler(jsonRequest(body, headers), d);
  return {
    status: response.status,
    text: await response.clone().text(),
    body: (await response.json()) as any,
  };
};

const customer = {
  name: 'Lucía Fotógrafa',
  phone: PHONE,
  email: 'lucia@example.com',
};
const item = (serviceId: string, variantId: string, quantity: number) => ({
  serviceId,
  variantId,
  quantity,
});
const glossy10 = () => item(IDS.svc10x15, variants.glossy10, 3);
const start = (
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.7' },
) =>
  call(
    handleProfessionalRequestStart,
    { clientKey: KEY, customer, items: [glossy10()], ...overrides },
    headers,
  );
const submit = (token: string, extra: Record<string, unknown> = {}) =>
  call(handleProfessionalRequestSubmit, { token, ...extra });

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
    {},
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
    {},
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

/** Every amount that exists in the seeded catalogs (cents): none may ever reach a visitor. */
const PRICES = ['30000', '25000', '32000', '60000', '20000', '50000', '80000'];
const noMoney = (text: string) => {
  for (const price of PRICES) expect(text).not.toContain(price);
  for (const word of [
    'unitPrice',
    'totalCents',
    'tiers',
    'Convenio',
    'priceList',
    'unit_price',
    'total_cents',
  ])
    expect(text).not.toContain(word);
};

const quote = (
  user: string,
  jobId: string,
  listId: string,
  customerId: string | null = null,
) =>
  asRole(w.db, 'authenticated', user, () =>
    w.db.query<any>(`select public.quote_photo_job($1,$2,$3,$4) r`, [
      IDS.business,
      jobId,
      listId,
      customerId,
    ]),
  );
const jobOf = async () =>
  (await rows(`select photo_job_id id from public.public_photo_orders`))[0]
    .id as string;

/** Sends one complete request (two sizes, mixed copies) and returns what the browser gets. */
async function sendRequest() {
  const started = await start({
    items: [
      item(IDS.svc10x15, variants.glossy10, 9),
      item(variants.matte10, variants.matte10, 2),
    ],
  });
  expect(started.status).toBe(200);
  const token = started.body.uploadToken as string;
  const g = dest(started, IDS.svc10x15);
  const m = dest(started, variants.matte10);
  const ids: string[] = [];
  for (const [name, copies] of [
    ['A.jpg', 3],
    ['B.jpg', 1],
    ['C.jpg', 5],
  ] as const) {
    const r = await upload(token, g, name, copies);
    expect(r.finalize?.status).toBe(200);
    ids.push(r.session.body.uploadId);
  }
  for (const [name, copies] of [
    ['M1.jpg', 1],
    ['M2.jpg', 1],
  ] as const) {
    const r = await upload(token, m, name, copies);
    expect(r.finalize?.status).toBe(200);
    ids.push(r.session.body.uploadId);
  }
  const done = await submit(token, {
    expectedFiles: { [g]: 3, [m]: 2 },
    uploadIds: ids,
  });
  return { started, done, token };
}

beforeEach(async () => {
  w = await createWorld();
  ({ lists, variants } = await seedProfessionalWorld(w));
});

describe('catálogo público profesional: sin precios', () => {
  it('un visitante ve tamaños y papeles, y ninguna cifra, tramo, lista ni convenio', async () => {
    const result = await call(handleProfessionalPublicCatalog, {});
    expect(result.status).toBe(200);
    expect(result.body.available).toBe(true);
    const names = result.body.services.map((x: any) => x.name);
    expect(names).toEqual(
      expect.arrayContaining([
        '10x15 · Brillo',
        '10x15 · Mate',
        '13x18 · Brillo',
      ]),
    );
    expect(result.body.services[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        variantId: expect.any(String),
        paper: expect.any(String),
      }),
    );
    noMoney(result.text);
    // Ni siquiera nombra a los clientes con cuenta o convenio.
    expect(result.text).not.toContain('Diego');
    expect(result.text).not.toContain('Estudio Luz');
  });

  it('un tamaño que sólo existe en un convenio no se anuncia ni se puede pedir', async () => {
    const service = (
      await rows(
        `insert into public.photo_services(id,business_id,name,service_type,width_mm,height_mm,default_unit_price_cents,
           workflow_route,requires_customer_files,is_public,public_order_enabled)
         values(gen_random_uuid(),$1,'Poster Diego','print',300,450,1,'lab',true,false,false) returning id`,
        [IDS.business],
      )
    )[0].id as string;
    const variant = (
      await rows(
        `select id from public.lab_variants where photo_service_id=$1 and paper='glossy'`,
        [service],
      )
    )[0].id as string;
    await w.db.query(
      `insert into public.lab_price_tiers(business_id,variant_id,price_list_id,min_quantity,unit_price_cents) values($1,$2,$3,1,99900)`,
      [IDS.business, variant, lists.diego],
    );
    const catalog = await call(handleProfessionalPublicCatalog, {});
    expect(catalog.text).not.toContain('Poster Diego');
    const refused = await start({ items: [item(service, variant, 1)] });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('service_unavailable');
    expect(refused.text).not.toContain('99900');
  });

  it('el catálogo vacío si Drive está desconectado (no acepta pedidos)', async () => {
    await w.db.query(
      `update public.google_drive_integrations set status='disconnected'`,
    );
    const result = await call(handleProfessionalPublicCatalog, {});
    expect(result.body).toMatchObject({ available: false, services: [] });
  });
});

describe('pedido anónimo: ningún importe en ninguna respuesta', () => {
  it('iniciar, subir y confirmar sin sesión; ninguna respuesta lleva dinero', async () => {
    const { started, done } = await sendRequest();
    noMoney(started.text);
    noMoney(done.text);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({
      status: 'received',
      quote: 'pending',
      alreadySubmitted: false,
    });
    expect(done.body.items).toEqual([
      { name: '10x15 · Brillo', quantity: 9 },
      { name: '10x15 · Mate', quantity: 2 },
    ]);
    expect(done.body.trackingToken).toBeTruthy();
  }, 60_000);

  it('el navegador no puede mandar precios: un expectedTotal o un priceListId no se lee ni cambia nada', async () => {
    const clean = await start();
    const withPrices = await start(
      {
        clientKey: 'request-client-key-bbbb',
        expectedTotalCents: 1,
        priceListId: lists.diego,
        unitPriceCents: 1,
        customerId: C.diego,
      },
      { 'cf-connecting-ip': '203.0.113.8' },
    );
    expect(withPrices.status).toBe(200);
    expect(Object.keys(withPrices.body)).toEqual(Object.keys(clean.body));
    noMoney(withPrices.text);
    const items = await rows(
      `select unit_price_cents::int u, total_cents::int t, price_list_id from public.photo_job_items`,
    );
    expect(
      items.every((x) => x.u === 0 && x.t === 0 && x.price_list_id === null),
    ).toBe(true);
    // El cliente enviado por el navegador tampoco se usa: sólo el teléfono identifica (como /imprimir).
    const customers = await rows(`select customer_id from public.photo_jobs`);
    expect(customers.every((x) => x.customer_id !== C.diego)).toBe(true);
  });

  it('no hay endpoint de consulta de precios: ni price_changed ni totales para sondear', async () => {
    for (const body of [
      { expectedTotalCents: 0 },
      { expectedTotalCents: 999999 },
    ]) {
      const r = await start(
        { clientKey: `request-client-key-${body.expectedTotalCents}`, ...body },
        {
          'cf-connecting-ip': `203.0.113.${(body.expectedTotalCents % 200) + 10}`,
        },
      );
      expect(r.status).toBe(200);
      expect(r.body.code).toBeUndefined();
    }
  });

  it('los endpoints de cuenta profesional siguen cerrados para el anónimo', async () => {
    const deps: ProfessionalDeps = {
      ...w.orderDeps,
      authenticate: async () => {
        throw new ApiError('Autorización inválida.', 401, 'unauthorized');
      },
    };
    const catalog = await call(handleProfessionalCatalog, {}, {}, deps);
    expect(catalog.status).toBe(401);
    const order = await call(
      handleProfessionalOrderStart,
      { clientKey: KEY, phone: PHONE, items: [glossy10()] },
      { Authorization: 'Bearer anon' },
      deps,
    );
    expect(order.status).toBe(401);
  });
});

describe('queda pendiente de presupuestar, nunca gratis ni pagado', () => {
  it('estado, origen, cantidades exactas y nada cobrado', async () => {
    const { done } = await sendRequest();
    expect(done.status).toBe(200);
    const job = (
      await rows(
        `select j.is_draft, j.source_channel, j.quote_status, j.file_intake_status, j.notes, o.status, o.portal,
                o.professional_account_id, o.payment_terms, o.whatsapp_opt_in
         from public.photo_jobs j join public.public_photo_orders o on o.photo_job_id=j.id`,
      )
    )[0];
    expect(job).toMatchObject({
      is_draft: false,
      source_channel: 'public_web',
      quote_status: 'pending_quote',
      file_intake_status: 'submitted',
      status: 'submitted',
      portal: 'profesionales',
      professional_account_id: null,
      payment_terms: null,
      // No se pidió consentimiento de WhatsApp: no se promete ni se encola ningún aviso.
      whatsapp_opt_in: false,
    });
    expect(job.notes).toContain('Solicitud profesional (web, sin cuenta)');
    expect(job.notes).toContain('pendiente de presupuestar');
    // Las cantidades son las copias pedidas por foto, no un importe.
    const items = await rows(
      `select service_name_snapshot n, quantity::int q, unit_price_cents::int u, total_cents::int t
       from public.photo_job_items where is_active order by created_at`,
    );
    expect(items).toEqual([
      { n: '10x15 · Brillo · Por presupuestar', q: 9, u: 0, t: 0 },
      { n: '10x15 · Mate · Por presupuestar', q: 2, u: 0, t: 0 },
    ]);
    // Ningún pago, ninguna acreditación.
    expect(await rows(`select 1 from public.work_payments`)).toHaveLength(0);
    expect(
      await rows(`select 1 from public.outbound_notifications`),
    ).toHaveLength(0);
  }, 60_000);

  it('aparece en el panel con su estado pendiente (RLS de CentroColor) y no se puede cobrar', async () => {
    await sendRequest();
    const id = await jobOf();
    const panel = await asRole(w.db, 'authenticated', IDS.staff, () =>
      w.db.query<any>(
        `select quote_status, customer_id from public.photo_jobs where id=$1`,
        [id],
      ),
    );
    expect(panel.rows).toEqual([
      expect.objectContaining({ quote_status: 'pending_quote' }),
    ]);
    const customerId = panel.rows[0].customer_id;
    const pay = (amount: number) =>
      asRole(w.db, 'authenticated', IDS.owner, () =>
        w.db.query(`select public.post_work_payment($1::jsonb)`, [
          JSON.stringify({
            id: crypto.randomUUID(),
            business_id: IDS.business,
            branch_id: IDS.branch,
            customer_id: customerId,
            source_type: 'photo_job',
            photo_job_id: id,
            payment_kind: 'payment',
            payment_method: 'cash',
            amount_cents: amount,
            occurred_at: new Date().toISOString(),
            created_by: IDS.owner,
          }),
        ]),
      );
    await expect(pay(100)).rejects.toThrow(/pendiente de presupuestar/);
    expect(await rows(`select 1 from public.work_payments`)).toHaveLength(0);
  }, 60_000);

  it('el personal no puede ponerle un importe a mano mientras está pendiente, ni cambiar su estado', async () => {
    await sendRequest();
    const id = await jobOf();
    const edit = (sql: string) =>
      asRole(w.db, 'authenticated', IDS.owner, () => w.db.query(sql, [id]));
    await expect(
      edit(
        `update public.photo_job_items set unit_price_cents=100, total_cents=quantity*100 where photo_job_id=$1`,
      ),
    ).rejects.toThrow(/pendiente de presupuestar/);
    await edit(
      `update public.photo_jobs set quote_status='quoted' where id=$1`,
    );
    expect(
      (
        await rows(`select quote_status from public.photo_jobs where id=$1`, [
          id,
        ])
      )[0].quote_status,
    ).toBe('pending_quote');
    // Un cliente tampoco puede crear un pedido manual ya "pendiente".
    await asRole(w.db, 'authenticated', IDS.owner, () =>
      w.db.query(
        `insert into public.photo_jobs(id,business_id,branch_id,customer_id,status,priority,created_by,quote_status)
         values(gen_random_uuid(),$1,$2,$3,'received','normal',$4,'pending_quote')`,
        [IDS.business, IDS.branch, C.retail, IDS.owner],
      ),
    );
    expect(
      (
        await rows(
          `select quote_status from public.photo_jobs where customer_id=$1`,
          [C.retail],
        )
      )[0].quote_status,
    ).toBe('quoted');
  }, 60_000);

  it('un pedido pendiente puede entrar en proceso, pero no se marca listo ni entregado hasta presupuestarlo', async () => {
    await sendRequest();
    const id = await jobOf();
    const setStatus = (status: string) =>
      asRole(w.db, 'authenticated', IDS.owner, () =>
        w.db.query(`update public.photo_jobs set status=$2 where id=$1`, [
          id,
          status,
        ]),
      );
    await setStatus('in_progress');
    await expect(setStatus('ready')).rejects.toThrow(
      /pendiente de presupuestar/,
    );
    await expect(setStatus('delivered')).rejects.toThrow(
      /pendiente de presupuestar/,
    );
    expect(
      (await rows(`select status from public.photo_jobs where id=$1`, [id]))[0]
        .status,
    ).toBe('in_progress');
    await quote(IDS.owner, id, lists.professional);
    await setStatus('ready');
    expect(
      (await rows(`select status from public.photo_jobs where id=$1`, [id]))[0]
        .status,
    ).toBe('ready');
    // Y el aviso de «listo» sólo existe si hubo consentimiento: esta solicitud no lo pidió.
    expect(
      await rows(`select 1 from public.outbound_notifications`),
    ).toHaveLength(0);
  }, 60_000);

  it('repetir el inicio con la misma clave reutiliza el borrador (no duplica nada)', async () => {
    const first = await start();
    const second = await start();
    expect(second.status).toBe(200);
    expect(await rows(`select 1 from public.photo_jobs`)).toHaveLength(1);
    expect(await rows(`select 1 from public.public_photo_orders`)).toHaveLength(
      1,
    );
    expect(
      await rows(
        `select 1 from public.customers where phone_match_key='3425557777'`,
      ),
    ).toHaveLength(1);
    expect(second.body.uploadToken).not.toBe(first.body.uploadToken);
  });

  it('una clave de otro portal no se puede reutilizar (ni al revés)', async () => {
    const publicBody = (clientKey: string) => ({
      clientKey,
      customer: { name: 'Ana', phone: '342 555 1111' },
      whatsappOptIn: true,
      items: [{ serviceId: IDS.svc10x15, quantity: 1 }],
    });
    // Una clave de /imprimir no abre una solicitud profesional…
    expect(
      (
        await call(
          handlePublicOrderStart,
          publicBody('shared-order-key-aaaaaa'),
        )
      ).status,
    ).toBe(200);
    expect((await start({ clientKey: 'shared-order-key-aaaaaa' })).status).toBe(
      400,
    );
    // …ni una clave de solicitud reabre el borrador desde /imprimir (sobrescribiría sus datos con precios).
    expect(
      (
        await start(
          { clientKey: 'request-client-key-cccc' },
          { 'cf-connecting-ip': '203.0.113.50' },
        )
      ).status,
    ).toBe(200);
    const steal = await call(
      handlePublicOrderStart,
      publicBody('request-client-key-cccc'),
    );
    expect(steal.status).toBe(400);
    const job = (
      await rows(
        `select j.quote_status, (select sum(total_cents)::int from public.photo_job_items where photo_job_id=j.id) total
         from public.photo_jobs j join public.public_photo_orders o on o.photo_job_id=j.id where o.client_key='request-client-key-cccc'`,
      )
    )[0];
    expect(job).toEqual({ quote_status: 'pending_quote', total: 0 });
    // El pedido de /imprimir quedó como era: cotizado, con su precio público.
    expect(
      (
        await rows(
          `select quote_status from public.photo_jobs j join public.public_photo_orders o on o.photo_job_id=j.id where o.client_key='shared-order-key-aaaaaa'`,
        )
      )[0].quote_status,
    ).toBe('quoted');
  });
});

describe('Drive: nombres con la cantidad definitiva, reintentos y varios formatos', () => {
  it('001_3copias.jpg… por tamaño y papel, numeración propia en cada carpeta', async () => {
    await sendRequest();
    const names = driveNames();
    expect(names).toEqual([
      '10x15 · Brillo · Por presupuestar/001_3copias.jpg',
      '10x15 · Brillo · Por presupuestar/002_1copia.jpg',
      '10x15 · Brillo · Por presupuestar/003_5copias.jpg',
      '10x15 · Mate · Por presupuestar/001_1copia.jpg',
      '10x15 · Mate · Por presupuestar/002_1copia.jpg',
    ]);
    const manifest = w.google.files.find((f) => f.name === 'PEDIDO.txt') as any;
    expect(manifest.text).toContain('Solicitud profesional (web, sin cuenta)');
    expect(manifest.text).not.toMatch(/\$|ARS/);
    // Las cantidades del pedido son la suma de copias de cada archivo.
    const q = await rows(
      `select service_name_snapshot n, quantity::int q from public.photo_job_items where is_active order by created_at`,
    );
    expect(q.map((x) => x.q)).toEqual([9, 2]);
  }, 60_000);

  it('reintentar una foto que ya llegó no la duplica y toma las copias nuevas', async () => {
    const started = await start();
    const token = started.body.uploadToken as string;
    const target = dest(started, IDS.svc10x15);
    const first = await upload(token, target, 'IMG_1.jpg', 2);
    const retry = await upload(
      token,
      target,
      'IMG_1.jpg',
      4,
      first.session.body.uploadId,
    );
    expect(retry.session.body.alreadyUploaded).toBe(true);
    const done = await submit(token, {
      expectedFiles: { [target]: 1 },
      uploadIds: [first.session.body.uploadId],
    });
    expect(done.status).toBe(200);
    expect(driveNames()).toEqual([
      '10x15 · Brillo · Por presupuestar/001_4copias.jpg',
    ]);
    expect(
      await rows(
        `select 1 from public.photo_job_files where status='uploaded'`,
      ),
    ).toHaveLength(1);
  }, 60_000);

  it('confirmar dos veces no duplica el pedido; falta una foto → no se confirma completo', async () => {
    const started = await start({
      items: [glossy10(), item(variants.matte10, variants.matte10, 1)],
    });
    const token = started.body.uploadToken as string;
    const g = dest(started, IDS.svc10x15);
    const m = dest(started, variants.matte10);
    const a = await upload(token, g, 'A.jpg');
    const incomplete = await submit(token, {
      expectedFiles: { [g]: 1, [m]: 1 },
      uploadIds: [a.session.body.uploadId],
    });
    expect(incomplete.status).toBe(409);
    expect(incomplete.body.code).toBe('order_incomplete');
    const b = await upload(token, m, 'B.jpg');
    const ids = [a.session.body.uploadId, b.session.body.uploadId];
    const one = await submit(token, {
      expectedFiles: { [g]: 1, [m]: 1 },
      uploadIds: ids,
    });
    const two = await submit(token, {
      expectedFiles: { [g]: 1, [m]: 1 },
      uploadIds: ids,
    });
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect(two.body.alreadySubmitted).toBe(true);
    expect(await rows(`select 1 from public.photo_jobs`)).toHaveLength(1);
    expect(
      await rows(
        `select 1 from public.photo_job_files where status='uploaded'`,
      ),
    ).toHaveLength(2);
  }, 60_000);
});

describe('seguimiento: nunca precios a un anónimo', () => {
  it('muestra estado y cantidades; antes y después de presupuestar no hay importes ni nombre de lista', async () => {
    const { done } = await sendRequest();
    const track = () =>
      call(handlePublicOrderTrack, { token: done.body.trackingToken });
    const before = await track();
    expect(before.status).toBe(200);
    noMoney(before.text);
    expect(before.body.request).toEqual({ quote: 'pending' });
    expect(before.body.items).toEqual([
      { name: '10x15 · Brillo', quantity: 9 },
      { name: '10x15 · Mate', quantity: 2 },
    ]);
    expect(before.body.totalCents).toBeUndefined();
    expect(before.body.paymentTerms).toBeUndefined();

    await quote(IDS.owner, await jobOf(), lists.professional);
    const after = await track();
    noMoney(after.text);
    expect(after.text).not.toContain('Profesional');
    expect(after.body.request).toEqual({ quote: 'quoted' });
    expect(after.body.totalCents).toBeUndefined();
  }, 60_000);

  it('el pedido de /imprimir sigue mostrando sus precios en el seguimiento', async () => {
    const pub = await call(handlePublicOrderStart, {
      clientKey: 'public-order-key-track1',
      customer: { name: 'Ana', phone: '342 555 1111' },
      whatsappOptIn: true,
      items: [{ serviceId: IDS.svc10x15, quantity: 2 }],
    });
    const target = pub.body.destinations[0].destinationId;
    const up = await upload(pub.body.uploadToken, target, 'x.jpg', 2);
    const done = await call(handlePublicOrderSubmit, {
      token: pub.body.uploadToken,
      uploadIds: [up.session.body.uploadId],
    });
    expect(done.status).toBe(200);
    expect(done.body.totalCents).toBe(100000);
    const tracked = await call(handlePublicOrderTrack, {
      token: done.body.trackingToken,
    });
    expect(tracked.body.totalCents).toBe(100000);
    expect(tracked.body.request).toBeUndefined();
  }, 60_000);
});

describe('aislamiento entre endpoints y pedidos', () => {
  it('el endpoint de /imprimir no confirma una solicitud profesional ni al revés', async () => {
    const started = await start();
    const token = started.body.uploadToken as string;
    const up = await upload(token, dest(started, IDS.svc10x15), 'a.jpg');
    const wrong = await call(handlePublicOrderSubmit, {
      token,
      uploadIds: [up.session.body.uploadId],
    });
    expect(wrong.status).toBe(404);
    const pub = await call(handlePublicOrderStart, {
      clientKey: 'public-order-key-iso111',
      customer: { name: 'Ana', phone: '342 555 1111' },
      whatsappOptIn: true,
      items: [{ serviceId: IDS.svc10x15, quantity: 1 }],
    });
    const reverse = await submit(pub.body.uploadToken);
    expect(reverse.status).toBe(404);
  }, 60_000);

  it('un token de otro pedido no sirve: cada solicitud tiene su capacidad', async () => {
    const one = await start();
    const two = await start(
      { clientKey: 'request-client-key-dddd' },
      { 'cf-connecting-ip': '203.0.113.60' },
    );
    const dst = dest(one, IDS.svc10x15);
    const crossed = await call(
      handleUploadSession,
      {
        token: two.body.uploadToken,
        destinationId: dst,
        filename: 'x.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 12,
        copies: 1,
      },
      {},
      w.uploadDeps,
    );
    expect(crossed.status).toBe(403);
  });
});

describe('administración: presupuestar desde CentroColor', () => {
  it('owner/admin presupuesta con la lista del cliente; el total sale del servidor y se puede cobrar', async () => {
    await sendRequest();
    const id = await jobOf();
    // Vincular al profesional correcto y usar SU lista (Profesional): 9 copias a 300, 2 mate a 320.
    const result = (await quote(IDS.owner, id, lists.professional, C.studio))
      .rows[0].r;
    expect(result).toMatchObject({
      total_cents: 9 * 30000 + 2 * 32000,
      price_list_name: 'Profesional',
      customer_id: C.studio,
    });
    const items = await rows(
      `select service_name_snapshot n, quantity::int q, unit_price_cents::int u, total_cents::int t, price_list_id
       from public.photo_job_items where photo_job_id=$1 and is_active order by created_at`,
      [id],
    );
    expect(items).toEqual([
      {
        n: '10x15 · Brillo · Profesional',
        q: 9,
        u: 30000,
        t: 270000,
        price_list_id: lists.professional,
      },
      {
        n: '10x15 · Mate · Profesional',
        q: 2,
        u: 32000,
        t: 64000,
        price_list_id: lists.professional,
      },
    ]);
    const job = (
      await rows(
        `select quote_status, customer_id from public.photo_jobs where id=$1`,
        [id],
      )
    )[0];
    expect(job).toEqual({ quote_status: 'quoted', customer_id: C.studio });
    expect(
      (
        await rows(
          `select customer_id from public.public_photo_orders where photo_job_id=$1`,
          [id],
        )
      )[0].customer_id,
    ).toBe(C.studio);
    // Circuito normal de cobro: ahora sí tiene un importe y admite pagos hasta el total.
    const pay = (amount: number) =>
      asRole(w.db, 'authenticated', IDS.staff, () =>
        w.db.query(`select public.post_work_payment($1::jsonb)`, [
          JSON.stringify({
            id: crypto.randomUUID(),
            business_id: IDS.business,
            branch_id: IDS.branch,
            customer_id: C.studio,
            source_type: 'photo_job',
            photo_job_id: id,
            payment_kind: 'payment',
            payment_method: 'cash',
            amount_cents: amount,
            occurred_at: new Date().toISOString(),
            created_by: IDS.staff,
          }),
        ]),
      );
    await pay(334000);
    await expect(pay(1)).rejects.toThrow(/saldo máximo cobrable/);
  }, 60_000);

  it('un convenio sin tarifa para un formato aborta todo el presupuesto y deja el pedido pendiente', async () => {
    await sendRequest();
    const id = await jobOf();
    await expect(quote(IDS.owner, id, lists.diego)).rejects.toThrow(
      /Convenio Diego.*no tiene precio/,
    );
    expect(
      (
        await rows(`select quote_status from public.photo_jobs where id=$1`, [
          id,
        ])
      )[0].quote_status,
    ).toBe('pending_quote');
    expect(
      await rows(
        `select 1 from public.photo_job_items where photo_job_id=$1 and unit_price_cents<>0`,
        [id],
      ),
    ).toHaveLength(0);
  }, 60_000);

  it('el tramo sale de las copias definitivas (100+ → tarifa de volumen)', async () => {
    const started = await start({
      items: [item(IDS.svc10x15, variants.glossy10, 100)],
    });
    const token = started.body.uploadToken as string;
    const target = dest(started, IDS.svc10x15);
    const ids: string[] = [];
    for (let i = 1; i <= 4; i += 1)
      ids.push(
        (await upload(token, target, `P${i}.jpg`, 25)).session.body.uploadId,
      );
    expect((await submit(token, { uploadIds: ids })).status).toBe(200);
    const result = (await quote(IDS.owner, await jobOf(), lists.professional))
      .rows[0].r;
    expect(result.total_cents).toBe(100 * 25000);
  }, 60_000);

  it('sólo owner/admin presupuesta; no el personal, ni un anónimo, ni otro negocio, ni dos veces', async () => {
    await sendRequest();
    const id = await jobOf();
    await expect(quote(IDS.staff, id, lists.professional)).rejects.toThrow(
      /Sólo owner\/admin/,
    );
    await expect(quote(IDS.outsider, id, lists.professional)).rejects.toThrow(
      /Sólo owner\/admin/,
    );
    await expect(
      asRole(w.db, 'anon', null, () =>
        w.db.query(`select public.quote_photo_job($1,$2,$3,null)`, [
          IDS.business,
          id,
          lists.professional,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    // Una cuenta profesional tampoco (no tiene membership).
    await expect(quote(U.studio, id, lists.professional)).rejects.toThrow(
      /Sólo owner\/admin/,
    );
    await quote(IDS.owner, id, lists.professional);
    await expect(quote(IDS.owner, id, lists.diego)).rejects.toThrow(
      /ya tiene un importe/,
    );
  }, 60_000);

  it('no presupuesta borradores, pedidos cancelados, listas inactivas ni clientes inexistentes', async () => {
    const draft = await start();
    const draftJob = await jobOf();
    await expect(
      quote(IDS.owner, draftJob, lists.professional),
    ).rejects.toThrow(/No se encontró el pedido/);
    void draft;
    await sendRequest();
    const done = (
      await rows(`select j.id from public.photo_jobs j where not j.is_draft`)
    )[0].id;
    await expect(
      quote(IDS.owner, done, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow(/lista de precios activa/);
    await expect(
      quote(
        IDS.owner,
        done,
        lists.professional,
        '00000000-0000-4000-8000-000000000000',
      ),
    ).rejects.toThrow(/cliente elegido/);
    await w.db.query(
      `update public.price_lists set is_active=false where id=$1`,
      [lists.diego],
    );
    await expect(quote(IDS.owner, done, lists.diego)).rejects.toThrow(
      /lista de precios activa/,
    );
    await asRole(w.db, 'authenticated', IDS.owner, () =>
      w.db.query(
        `update public.photo_jobs set status='cancelled' where id=$1`,
        [done],
      ),
    );
    await expect(quote(IDS.owner, done, lists.professional)).rejects.toThrow(
      /cancelado/,
    );
  }, 60_000);
});

describe('acceso: cuenta profesional y administración no se mezclan', () => {
  const deps = (): ProfessionalDeps => ({
    ...w.orderDeps,
    authenticate: async (request) => {
      const userId = request.headers.get('x-test-user');
      if (!userId)
        throw new ApiError('Autorización inválida.', 401, 'unauthorized');
      return { userId };
    },
  });
  const as = (userId: string) => ({
    Authorization: 'Bearer t',
    'x-test-user': userId,
  });

  it('un profesional autenticado conserva su lista, sus precios y su condición de pago', async () => {
    const result = await call(
      handleProfessionalCatalog,
      {},
      as(U.diego),
      deps(),
    );
    expect(result.status).toBe(200);
    expect(result.body.account).toMatchObject({
      priceListName: 'Convenio Diego',
      paymentTerms: 'deferred',
    });
    expect(result.body.services[0].unitPriceCents).toBe(20000);
  });

  it('una sesión de administración no recibe acceso ni precios profesionales', async () => {
    for (const user of [IDS.owner, IDS.staff]) {
      const result = await call(
        handleProfessionalCatalog,
        {},
        as(user),
        deps(),
      );
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('not_professional');
      for (const price of PRICES) expect(result.text).not.toContain(price);
      const order = await call(
        handleProfessionalOrderStart,
        {
          clientKey: 'admin-session-key-aaaa',
          phone: PHONE,
          items: [glossy10()],
        },
        as(user),
        deps(),
      );
      expect(order.status).toBe(403);
    }
    // Y en el portal sin cuenta, la misma sesión de administración sigue viendo un catálogo sin precios.
    const anon = await call(handleProfessionalPublicCatalog, {}, as(IDS.owner));
    noMoney(anon.text);
  });
});

describe('antiabuso de la carga anónima (servidor)', () => {
  it('la trampa para bots (honeypot) rechaza la solicitud', async () => {
    const result = await start({ website: 'https://spam.example' });
    expect(result.status).toBe(400);
    expect(await rows(`select 1 from public.photo_jobs`)).toHaveLength(0);
  });

  it('valida la entrada: nombre, teléfono, correo, cantidades, formatos repetidos', async () => {
    const bad = async (overrides: Record<string, unknown>, status = 400) =>
      expect(
        (await start({ clientKey: 'request-client-key-bad1', ...overrides }))
          .status,
      ).toBe(status);
    await bad({ customer: { name: 'A', phone: PHONE } });
    await bad({ customer: { name: 'Lucía', phone: 'abc' } }, 422);
    await bad({
      customer: { name: 'Lucía', phone: PHONE, email: 'no-es-un-correo' },
    });
    await bad({ items: [] });
    await bad({ items: [item(IDS.svc10x15, variants.glossy10, 0)] });
    await bad({ items: [item(IDS.svc10x15, variants.glossy10, 50001)] });
    await bad({ items: [glossy10(), glossy10()] });
    await bad({ items: [{ serviceId: IDS.svc10x15, quantity: 1 }] });
    await bad({ clientKey: 'corta' });
  });

  it('límite por cliente (IP), por teléfono, por día y global; los reintentos de un mismo pedido no cuentan', async () => {
    const ip = { 'cf-connecting-ip': '198.51.100.9' };
    for (let i = 0; i < 6; i += 1)
      expect(
        (
          await start(
            {
              clientKey: `request-by-ip-key-${i}00000`,
              customer: { ...customer, phone: `342 555 20${i}0` },
            },
            ip,
          )
        ).status,
      ).toBe(200);
    // Repetir una clave existente es el mismo pedido: no es un pedido nuevo.
    expect(
      (
        await start(
          {
            clientKey: 'request-by-ip-key-000000',
            customer: { ...customer, phone: '342 555 2000' },
          },
          ip,
        )
      ).status,
    ).toBe(200);
    const seventh = await start(
      {
        clientKey: 'request-by-ip-key-700000',
        customer: { ...customer, phone: '342 555 2070' },
      },
      ip,
    );
    expect(seventh.status).toBe(429);
    expect(seventh.body.code).toBe('rate_limited');
    // Otra IP, mismo teléfono: 4 por hora.
    for (let i = 0; i < 4; i += 1)
      expect(
        (
          await start(
            { clientKey: `request-by-tel-key-${i}0000`, customer },
            { 'cf-connecting-ip': `198.51.100.${20 + i}` },
          )
        ).status,
      ).toBe(200);
    const fifth = await start(
      { clientKey: 'request-by-tel-key-500000', customer },
      { 'cf-connecting-ip': '198.51.100.99' },
    );
    expect(fifth.status).toBe(429);
    // Pasada la hora, el cupo horario se libera (el diario sigue contando).
    w.advance(61 * 60 * 1000);
    expect(
      (
        await start(
          {
            clientKey: 'request-after-hour-00000',
            customer: { ...customer, phone: '342 555 3001' },
          },
          ip,
        )
      ).status,
    ).toBe(200);
  }, 120_000);

  it('tope global por hora', async () => {
    const base = (await rows(`select id from public.branches limit 1`))[0].id;
    for (let i = 0; i < 60; i += 1) {
      const job = (
        await rows(
          `insert into public.photo_jobs(id,business_id,branch_id,customer_id,status,priority,file_intake_status,source_channel,is_draft,quote_status,created_by)
           values(gen_random_uuid(),$1,$2,$3,'received','normal','awaiting_files','public_web',true,'pending_quote',$4) returning id`,
          [IDS.business, base, C.retail, IDS.owner],
        )
      )[0].id;
      await w.db.query(
        `insert into public.public_photo_orders(business_id,photo_job_id,customer_id,client_key,customer_name,whatsapp_e164,whatsapp_opt_in,portal)
         values($1,$2,$3,$4,'X','+5493425550000',false,'profesionales')`,
        [
          IDS.business,
          job,
          C.retail,
          `seed-global-key-${String(i).padStart(6, '0')}`,
        ],
      );
    }
    const refused = await start(
      { clientKey: 'request-global-key-0001' },
      { 'cf-connecting-ip': '192.0.2.77' },
    );
    expect(refused.status).toBe(429);
  }, 120_000);

  it('límites de carga: 500 fotos, 100 MB por foto y 5 GB por pedido; /imprimir y las cuentas conservan los suyos', async () => {
    const started = await start();
    const token = started.body.uploadToken as string;
    const target = dest(started, IDS.svc10x15);
    const job = await jobOf();
    const itemId = (
      await rows(
        `select id from public.photo_job_items where photo_job_id=$1`,
        [job],
      )
    )[0].id;
    const session = (size: number, name = 'g.jpg', extension = 'jpg') =>
      call(
        handleUploadSession,
        {
          token,
          destinationId: target,
          filename: name.replace('jpg', extension),
          mimeType: 'image/jpeg',
          sizeBytes: size,
          copies: 1,
        },
        {},
        w.uploadDeps,
      );
    // Tamaño por foto: 100 MB como el público (la cuenta profesional admite 300).
    expect((await session(101 * 1024 * 1024)).status).toBe(400);
    expect((await session(100 * 1024 * 1024)).status).toBe(200);
    // Formatos: sólo fotos (nada de RAW ni ejecutables).
    expect((await session(10, 'g.jpg', 'cr2')).status).toBe(400);
    expect((await session(10, 'g.jpg', 'exe')).status).toBe(400);
    // Tamaño total del pedido: 5 GB (50 de 100 MB ya suman 5000 MB; el 52.º no entra).
    let refused: any = null;
    for (let i = 0; i < 60 && !refused; i += 1) {
      const r = await session(100 * 1024 * 1024);
      if (r.status !== 200) refused = r;
    }
    expect(refused?.status).toBe(409);
    expect(refused?.body.code).toBe('order_too_large');
    // Cantidad: con 500 fotos cargadas, la 501.ª no entra (el público corta en 200, la cuenta en 1000).
    await w.db.query(
      `delete from public.photo_job_files where photo_job_id=$1`,
      [job],
    );
    await w.db.query(
      `insert into public.photo_job_files(business_id,photo_job_id,photo_job_item_id,drive_file_id,drive_folder_id,
         original_filename,stored_filename,size_bytes,copies,workflow_route,status,created_at)
       select $1,$2,$3,'d'||g,'folder','a'||g||'.jpg','x'||g,10,1,'lab','uploaded',now()-interval '1 hour' from generate_series(1,500) g`,
      [IDS.business, job, itemId],
    );
    const full = await session(12);
    expect(full.status).toBe(409);
    expect(full.body.code).toBe('too_many_files');
    // Por debajo de 500 todavía se acepta (el tope no es el del público).
    await w.db.query(
      `delete from public.photo_job_files where drive_file_id in ('d500','d499')`,
    );
    expect((await session(12)).status).toBe(200);
  }, 180_000);

  it('ritmo de carga: más que el público por minuto, menos que una cuenta', async () => {
    const started = await start();
    const token = started.body.uploadToken as string;
    const target = dest(started, IDS.svc10x15);
    const job = await jobOf();
    const itemId = (
      await rows(
        `select id from public.photo_job_items where photo_job_id=$1`,
        [job],
      )
    )[0].id;
    let batch = 0;
    const insertRecent = (n: number) =>
      w.db.query(
        `insert into public.photo_job_files(business_id,photo_job_id,photo_job_item_id,drive_file_id,drive_folder_id,
           original_filename,stored_filename,size_bytes,copies,workflow_route,status,created_at)
         select $1,$2,$3,'r'||$5::text||'-'||g,'folder','a'||g||'.jpg','x'||g,10,1,'lab','failed',now() from generate_series(1,$4::int) g`,
        [IDS.business, job, itemId, n, (batch += 1)],
      );
    const session = () =>
      call(
        handleUploadSession,
        {
          token,
          destinationId: target,
          filename: 'g.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 12,
          copies: 1,
        },
        {},
        w.uploadDeps,
      );
    await insertRecent(200); // el público ya estaría frenado (120/min)
    expect((await session()).status).toBe(200);
    await insertRecent(40);
    const refused = await session();
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('rate_limited');
  }, 120_000);
});
