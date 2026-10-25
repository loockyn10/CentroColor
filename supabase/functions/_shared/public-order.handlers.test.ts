/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows and JSON bodies are untyped in tests. */
// Public order flow end to end: real handlers → real stores → real migrations (PGlite) →
// real Drive gateway over an emulated Google. Browser and Meta are the only doubles.
import { beforeEach, describe, expect, it } from 'vitest';
import { RATE_LIMITS } from './public-order-handlers';
import { IDS, asRole } from './pg-harness';
import { orderFlow } from './pg-order-flow';
import { authenticatedCount, createWorld, type World } from './pg-world';
import {
  handleUploadFinalize,
  handleUploadSession,
  handleUploadSubmit,
} from './upload-handlers';

let w: World;
const { call, catalog, start, submit, track, upload, placeOrder } = orderFlow(
  () => w,
);

beforeEach(async () => {
  w = await createWorld();
});

describe('catálogo público', () => {
  it('sólo publica variantes disponibles con tiers públicos del catálogo administrativo', async () => {
    const { status, body } = await catalog();
    expect(status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.businessName).toBe('CentroColor');
    expect(body.services).toMatchObject([
      {
        id: IDS.svc10x15,
        name: '10x15 · Brillo',
        description: 'Papel brillante',
        widthMm: 100,
        heightMm: 150,
        unitPriceCents: 50000,
        variantId: expect.any(String),
        tiers: [{ minQuantity: 1, maxQuantity: null, unitPriceCents: 50000 }],
      },
      {
        id: IDS.svc13x18,
        name: '13x18 · Brillo',
        description: null,
        widthMm: 130,
        heightMm: 180,
        unitPriceCents: 80000,
      },
      {
        id: IDS.svc20x30,
        name: '20x30 · Brillo',
        description: null,
        widthMm: 200,
        heightMm: 300,
        unitPriceCents: 250000,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('Restauración');
    expect(JSON.stringify(body)).not.toContain(IDS.svcOtherBusiness);
  });

  it('el tier público es la tarifa; un servicio desactivado desaparece', async () => {
    await w.db.query(
      `update public.lab_price_tiers set unit_price_cents=60000 where variant_id=(
        select id from public.lab_variants where photo_service_id=$1 and paper='glossy')`,
      [IDS.svc10x15],
    );
    await w.db.query(
      `update public.photo_services set is_active=false where id=$1`,
      [IDS.svc13x18],
    );
    const { body } = await catalog();
    expect(body.services.map((s: any) => [s.name, s.unitPriceCents])).toEqual([
      ['10x15 · Brillo', 60000],
      ['20x30 · Brillo', 250000],
    ]);
  });

  it('sin Google Drive conectado no ofrece pedidos', async () => {
    await w.db.query(
      `update public.google_drive_integrations set status='disconnected'`,
    );
    const { body } = await catalog();
    expect(body).toMatchObject({ available: false, services: [] });
    const attempt = await start();
    expect(attempt.status).toBe(503);
    expect(attempt.body.code).toBe('orders_unavailable');
  });

  it('no filtra ni columnas internas ni identificadores del negocio', async () => {
    const { body } = await catalog();
    const text = JSON.stringify(body);
    for (const secret of [
      'workflow',
      'business_id',
      IDS.business,
      'requires_customer_files',
      'code',
    ])
      expect(text, secret).not.toContain(secret);
  });
});

describe('inicio del pedido: Customer + PhotoJob + items, validados en el servidor', () => {
  it('crea todo, calcula el total con el precio del catálogo y devuelve destinos opacos', async () => {
    const { status, body } = await start({
      items: [
        { serviceId: IDS.svc10x15, quantity: 3 },
        { serviceId: IDS.svc20x30, quantity: 1 },
      ],
      expectedTotalCents: 400000,
    });
    expect(status).toBe(200);
    expect(body.totalCents).toBe(3 * 50000 + 250000);
    expect(body.orderCode).toMatch(/^CC-[0-9A-F]{8}$/);
    expect(body.customerFirstName).toBe('María');
    expect(body.destinations).toHaveLength(2);
    expect(body.uploadToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const text = JSON.stringify(body);
    expect(text).not.toContain(IDS.business);
    const row = (await w.db.query<any>(`select phone from public.customers`))
      .rows[0];
    expect(row.phone).toBe('+54 9 342 555 1234');
    const order = (
      await w.db.query<any>(
        `select whatsapp_e164, whatsapp_opt_in, status, consent_source from public.public_photo_orders`,
      )
    ).rows[0];
    expect(order).toEqual({
      whatsapp_e164: '+5493425551234',
      whatsapp_opt_in: true,
      status: 'draft',
      consent_source: 'public_order',
    });
  });

  it('un precio o total manipulado es inútil: el servidor usa el catálogo y avisa si el total mostrado era viejo', async () => {
    const forged = await start({
      items: [
        {
          serviceId: IDS.svc10x15,
          quantity: 3,
          unitPriceCents: 1,
          totalCents: 1,
        },
      ],
      total: 1,
      totalCents: 1,
      unit_price_cents: 1,
    });
    expect(forged.status).toBe(200);
    expect(forged.body.totalCents).toBe(150000);
    const items = (
      await w.db.query<any>(
        `select unit_price_cents p, total_cents t from public.photo_job_items`,
      )
    ).rows;
    expect(items).toEqual([{ p: 50000, t: 150000 }]);

    const stale = await start({
      clientKey: 'client-key-bbbbbbbbbbbb',
      expectedTotalCents: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('price_changed');
    expect(
      (
        await w.db.query<any>(
          `select count(*)::int n from public.public_photo_orders`,
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('el precio cambia en el catálogo entre la lectura y el pedido: falla sin crear nada (carrera)', async () => {
    const original = w.orders.getPublicServices.bind(w.orders);
    w.orders.getPublicServices = async (b, ids) => {
      const rows = await original(b, ids);
      await w.db.query(
        `update public.photo_services set default_unit_price_cents=70000 where id=$1`,
        [IDS.svc10x15],
      );
      return rows;
    };
    const result = await start({ clientKey: 'client-key-cccccccccccc' });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('price_changed');
    expect(
      (await w.db.query<any>(`select count(*)::int n from public.photo_jobs`))
        .rows[0].n,
    ).toBe(0);
  });

  it('rechaza servicios no públicos, de otro negocio, inventados o duplicados', async () => {
    for (const serviceId of [
      IDS.svcPrivate,
      IDS.svcOtherBusiness,
      'a0000000-0000-4000-8000-0000000000aa',
    ]) {
      const result = await start({ items: [{ serviceId, quantity: 1 }] });
      expect(result.status, serviceId).toBe(409);
      expect(result.body.code).toBe('service_unavailable');
    }
    const duplicated = await start({
      items: [
        { serviceId: IDS.svc10x15, quantity: 1 },
        { serviceId: IDS.svc10x15, quantity: 2 },
      ],
    });
    expect(duplicated.status).toBe(400);
    expect(
      (await w.db.query<any>(`select count(*)::int n from public.photo_jobs`))
        .rows[0].n,
    ).toBe(0);
  });

  it.each([
    ['cantidad 0', { items: [{ serviceId: IDS.svc10x15, quantity: 0 }] }],
    [
      'cantidad decimal',
      { items: [{ serviceId: IDS.svc10x15, quantity: 1.5 }] },
    ],
    [
      'cantidad enorme',
      { items: [{ serviceId: IDS.svc10x15, quantity: 100000 }] },
    ],
    ['sin items', { items: [] }],
    ['nombre vacío', { customer: { name: ' ', phone: '3425551234' } }],
    [
      'email inválido',
      { customer: { name: 'Ana', phone: '3425551234', email: 'nope' } },
    ],
    [
      'nota demasiado larga',
      {
        customer: { name: 'Ana', phone: '3425551234', notes: 'x'.repeat(501) },
      },
    ],
    ['clave corta', { clientKey: 'short' }],
    ['consentimiento no booleano', { whatsappOptIn: 'yes' }],
    ['honeypot completado', { website: 'http://spam.example' }],
  ])('rechaza %s sin crear nada', async (_label, overrides) => {
    const result = await start(overrides as Record<string, unknown>);
    expect(result.status).toBe(400);
    expect(
      (await w.db.query<any>(`select count(*)::int n from public.photo_jobs`))
        .rows[0].n,
    ).toBe(0);
  });

  it('rechaza un WhatsApp inválido con un mensaje útil', async () => {
    const result = await start({ customer: { name: 'Ana', phone: '12' } });
    expect(result.status).toBe(422);
    expect(result.body.code).toBe('invalid_phone');
  });

  it('el doble submit con la misma clave es idempotente: un job, un customer, items sin duplicar', async () => {
    const [a, b] = await Promise.all([start(), start()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    for (const table of [
      'photo_jobs',
      'photo_job_items',
      'customers',
      'public_photo_orders',
    ])
      expect(
        (await w.db.query<any>(`select count(*)::int n from public.${table}`))
          .rows[0].n,
        table,
      ).toBe(1);
  });

  it('un cliente existente (mismo teléfono, otro formato) se reutiliza sin tocar su ficha', async () => {
    await w.db.query(
      `insert into public.customers(id,business_id,full_name,phone) values (gen_random_uuid(),$1,'Cliente histórico','0342 555-1234')`,
      [IDS.business],
    );
    const result = await start({
      customer: { name: 'Otra persona', phone: '+54 9 342 555 1234' },
    });
    expect(result.status).toBe(200);
    const customers = (
      await w.db.query<any>(`select full_name, phone from public.customers`)
    ).rows;
    expect(customers).toEqual([
      { full_name: 'Cliente histórico', phone: '0342 555-1234' },
    ]);
    const response = JSON.stringify(result.body);
    expect(response).not.toContain('histórico');
    expect(response).not.toContain('0342');
  });

  it('un teléfono local normalizado a E.164 se guarda normalizado', async () => {
    await start({ customer: { name: 'Ana', phone: '(342) 555-1234' } });
    expect(
      (
        await w.db.query<any>(
          `select whatsapp_e164 from public.public_photo_orders`,
        )
      ).rows[0].whatsapp_e164,
    ).toBe('+5493425551234');
  });

  it('sin tildar el consentimiento no se guarda opt-in', async () => {
    await start({ whatsappOptIn: false });
    expect(
      (
        await w.db.query<any>(
          `select whatsapp_opt_in, whatsapp_opt_in_at from public.public_photo_orders`,
        )
      ).rows[0],
    ).toEqual({ whatsapp_opt_in: false, whatsapp_opt_in_at: null });
  });

  it('limita pedidos por teléfono y por cliente (rate limit razonable)', async () => {
    for (let i = 0; i < RATE_LIMITS.perHourPerPhone; i += 1) {
      const result = await start({
        clientKey: `client-key-${String(i).padStart(12, '0')}`,
      });
      expect(result.status).toBe(200);
    }
    const blocked = await start({ clientKey: 'client-key-zzzzzzzzzzzz' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('rate_limited');
    // Otra persona, otra IP: sigue pudiendo pedir.
    const other = await start(
      {
        clientKey: 'client-key-yyyyyyyyyyyy',
        customer: { name: 'Otra', phone: '351 555 0000' },
      },
      { 'cf-connecting-ip': '203.0.113.9' },
    );
    expect(other.status).toBe(200);
  });

  it('limita por dirección de cliente', async () => {
    for (let i = 0; i < RATE_LIMITS.perHourPerClient; i += 1) {
      const result = await start(
        {
          clientKey: `client-key-${String(i).padStart(12, '0')}`,
          customer: { name: 'Ana', phone: `351 555 ${String(1000 + i)}` },
        },
        { 'cf-connecting-ip': '198.51.100.7' },
      );
      expect(result.status, String(i)).toBe(200);
    }
    const blocked = await start(
      {
        clientKey: 'client-key-zzzzzzzzzzzz',
        customer: { name: 'Ana', phone: '351 555 9999' },
      },
      { 'cf-connecting-ip': '198.51.100.7' },
    );
    expect(blocked.status).toBe(429);
  });
});

describe('pedido abandonado: nunca llega a Producción', () => {
  it('un pedido iniciado con archivos a medias queda invisible para los miembros', async () => {
    const started = await start();
    const token = started.body.uploadToken as string;
    await upload(
      token,
      started.body.destinations[0].destinationId,
      'IMG_001.jpg',
      2,
    );
    for (const table of [
      'photo_jobs',
      'photo_job_items',
      'photo_job_files',
      'public_photo_orders',
    ])
      expect(await authenticatedCount(w.db, IDS.staff, table), table).toBe(0);
    const queue = await asRole(
      w.db,
      'authenticated',
      IDS.staff,
      async () =>
        (
          await w.db.query<any>(
            `select count(*)::int n from public.photo_jobs where file_intake_status='submitted'`,
          )
        ).rows[0].n,
    );
    expect(queue).toBe(0);
  });

  it('se puede retomar con la misma clave: el link viejo se revoca y el nuevo funciona', async () => {
    const first = await start();
    const oldToken = first.body.uploadToken as string;
    const second = await start();
    expect(second.body.uploadToken).not.toBe(oldToken);
    const old = await upload(
      oldToken,
      first.body.destinations[0].destinationId,
      'a.jpg',
    );
    expect(old.session.status).toBe(410);
    const fresh = await upload(
      second.body.uploadToken,
      second.body.destinations[0].destinationId,
      'a.jpg',
    );
    expect(fresh.finalize?.status).toBe(200);
  });
});

describe('confirmación', () => {
  it('deriva las cantidades de las copias subidas, congela el snapshot y publica en Producción', async () => {
    const { done } = await placeOrder();
    expect(done.body).toMatchObject({
      status: 'received',
      alreadySubmitted: false,
      totalCents: 3 * 50000 + 250000,
    });
    expect(done.body.items).toEqual([
      { name: '10x15', quantity: 3, totalCents: 150000 },
      { name: '20x30', quantity: 1, totalCents: 250000 },
    ]);
    expect(done.body.trackingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const job = (
      await w.db.query<any>(
        `select status, file_intake_status, is_draft, source_channel from public.photo_jobs`,
      )
    ).rows[0];
    expect(job).toEqual({
      status: 'received',
      file_intake_status: 'submitted',
      is_draft: false,
      source_channel: 'public_web',
    });
    expect(await authenticatedCount(w.db, IDS.staff, 'photo_jobs')).toBe(1);
    expect(await authenticatedCount(w.db, IDS.staff, 'photo_job_files')).toBe(
      3,
    );
  });

  it('la cantidad final sale de los archivos, no de lo que el cliente dijo al empezar', async () => {
    const started = await start({
      items: [{ serviceId: IDS.svc10x15, quantity: 50 }],
    });
    const token = started.body.uploadToken as string;
    await upload(token, started.body.destinations[0].destinationId, 'a.jpg', 2);
    await upload(token, started.body.destinations[0].destinationId, 'b.jpg', 1);
    const done = await submit(token);
    expect(done.body.items).toEqual([
      { name: '10x15', quantity: 3, totalCents: 150000 },
    ]);
  });

  it('escribe PEDIDO.txt en Drive con las copias y marca el origen web', async () => {
    await placeOrder();
    const manifest = w.google.files.find((x) => x.name === 'PEDIDO.txt') as any;
    expect(manifest.text).toContain('Pedido web (autoservicio)');
    expect(manifest.text).toContain('IMG_001.jpg | 2 copias');
    expect(manifest.text).toContain('IMG_002.jpg | 1 copia');
    expect(manifest.text).not.toContain('copias enviadas de');
  });

  it('el reintento de la confirmación no duplica nada y entrega un nuevo token de seguimiento', async () => {
    const { token, done } = await placeOrder();
    const again = await submit(token);
    expect(again.status).toBe(200);
    expect(again.body.alreadySubmitted).toBe(true);
    expect(again.body.trackingToken).not.toBe(done.body.trackingToken);
    expect(again.body.totalCents).toBe(done.body.totalCents);
    expect(
      (await w.db.query<any>(`select count(*)::int n from public.photo_jobs`))
        .rows[0].n,
    ).toBe(1);
    expect(w.google.files.filter((x) => x.name === 'PEDIDO.txt')).toHaveLength(
      1,
    );
    expect((await track(again.body.trackingToken)).status).toBe(200);
  });

  it('rechaza confirmar con cargas pendientes o sin archivos', async () => {
    const started = await start();
    const token = started.body.uploadToken as string;
    expect((await submit(token)).body.code).toBe('no_uploaded_files');
    const session = await call(handleUploadSession, w.uploadDeps, {
      token,
      destinationId: started.body.destinations[0].destinationId,
      filename: 'a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 5,
      copies: 1,
    });
    expect(session.status).toBe(200);
    const pending = await submit(token);
    expect(pending.status).toBe(409);
    expect(pending.body.code).toBe('uploads_pending');
    expect(await authenticatedCount(w.db, IDS.staff, 'photo_jobs')).toBe(0);
  });

  it('si Drive falla al escribir PEDIDO.txt no se confirma nada y el reintento funciona', async () => {
    const started = await start();
    const token = started.body.uploadToken as string;
    await upload(token, started.body.destinations[0].destinationId, 'a.jpg', 2);
    w.google.state.driveFailure = { status: 503, reason: 'backendError' };
    const failed = await submit(token);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(failed.body)).not.toMatch(/drive|google|supabase/i);
    expect(
      (await w.db.query<any>(`select is_draft from public.photo_jobs`)).rows[0]
        .is_draft,
    ).toBe(true);
    w.google.state.driveFailure = null;
    expect((await submit(token)).status).toBe(200);
    expect(
      (await w.db.query<any>(`select is_draft from public.photo_jobs`)).rows[0]
        .is_draft,
    ).toBe(false);
  });

  it('el link de subida deja de aceptar archivos y el submit manual de Sprint 13 no cierra un borrador', async () => {
    const { token, started } = await placeOrder().then((x) => ({
      token: x.token,
      started: x.started,
    }));
    const after = await upload(
      token,
      started.body.destinations[0].destinationId,
      'late.jpg',
    );
    expect(after.session.status).toBe(409);
    expect(after.session.body.code).toBe('link_submitted');

    const draft = await start({
      clientKey: 'client-key-bbbbbbbbbbbb',
      customer: { name: 'Ana', phone: '351 555 1111' },
    });
    const manual = await call(handleUploadSubmit, w.uploadDeps, {
      token: draft.body.uploadToken,
    });
    expect(manual.status).toBe(409);
    expect(manual.body.code).toBe('use_public_order_submit');
  });
});

describe('límites del pedido anónimo (protegen el Drive del negocio)', () => {
  const session = (
    token: string,
    destinationId: string,
    patch: Record<string, unknown>,
  ) =>
    call(handleUploadSession, w.uploadDeps, {
      token,
      destinationId,
      filename: 'IMG_001.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      copies: 1,
      ...patch,
    });

  it('sólo acepta formatos de foto de celular/cámara (sin RAW ni otros) y hasta 100 MB por foto', async () => {
    const started = await start();
    const token = started.body.uploadToken as string;
    const destination = started.body.destinations[0].destinationId as string;
    expect(
      (
        await session(token, destination, {
          filename: 'raw.cr2',
          mimeType: 'application/octet-stream',
        })
      ).body.code,
    ).toBe('invalid_format');
    expect(
      (
        await session(token, destination, {
          filename: 'big.jpg',
          sizeBytes: 100 * 1024 * 1024 + 1,
        })
      ).body.code,
    ).toBe('invalid_size');
    expect(
      (await session(token, destination, { sizeBytes: 100 * 1024 * 1024 }))
        .status,
    ).toBe(200);
    expect(
      (await session(token, destination, { filename: 'iphone.HEIC' })).status,
    ).toBe(200);
  });

  it('limita la cantidad de fotos por pedido', async () => {
    const started = await start();
    const token = started.body.uploadToken as string;
    const job = (
      await w.db.query<any>(
        `select id, (select id from public.photo_job_items limit 1) item from public.photo_jobs`,
      )
    ).rows[0];
    await w.db.query(
      `insert into public.photo_job_files(business_id, photo_job_id, photo_job_item_id, drive_file_id, drive_folder_id, original_filename, stored_filename, size_bytes, workflow_route, status)
       select $1, $2, $3, 'f' || g, 'folder', 'a.jpg', 'a.jpg', 1, 'lab', 'uploaded' from generate_series(1, 200) g`,
      [IDS.business, job.id, job.item],
    );
    const blocked = await session(
      token,
      started.body.destinations[0].destinationId,
      {},
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('too_many_files');
  });
});

describe('seguimiento público', () => {
  it('muestra sólo código, fecha, resumen, total y estado', async () => {
    const { done } = await placeOrder();
    await w.db.query(
      `update public.photo_jobs set notes='NOTA INTERNA secreta'`,
    );
    const result = await track(done.body.trackingToken);
    expect(result.status).toBe(200);
    expect(Object.keys(result.body).sort()).toEqual([
      'businessName',
      'createdAt',
      'items',
      'orderCode',
      'status',
      'totalCents',
    ]);
    expect(result.body).toMatchObject({
      businessName: 'CentroColor',
      status: 'received',
      totalCents: 400000,
    });
    expect(result.body.items).toEqual([
      { name: '10x15', quantity: 3, totalCents: 150000 },
      { name: '20x30', quantity: 1, totalCents: 250000 },
    ]);
    const text = JSON.stringify(result.body);
    for (const leak of [
      'NOTA INTERNA',
      '5493425551234',
      '342',
      'María',
      'García',
      IDS.business,
      'drive',
      'Drive',
      'unitPrice',
      'uuid',
    ])
      expect(text, leak).not.toContain(leak);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}/);
  });

  it.each(['received', 'in_progress', 'ready', 'delivered', 'cancelled'])(
    'refleja el estado %s del trabajo',
    async (status) => {
      const { done } = await placeOrder();
      await w.db.query(`update public.photo_jobs set status=$1`, [status]);
      expect((await track(done.body.trackingToken)).body.status).toBe(status);
    },
  );

  it('el seguimiento nunca muta: el token de seguimiento no sirve para subir ni confirmar', async () => {
    const { done, started } = await placeOrder();
    const tracking = done.body.trackingToken as string;
    const attempt = await call(handleUploadSession, w.uploadDeps, {
      token: tracking,
      destinationId: started.body.destinations[0].destinationId,
      filename: 'x.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 5,
      copies: 1,
    });
    expect(attempt.status).toBe(404);
    expect((await submit(tracking)).status).toBe(404);
    expect(
      (
        await call(handleUploadFinalize, w.uploadDeps, {
          token: tracking,
          uploadId: IDS.owner,
        })
      ).status,
    ).toBe(404);
  });

  it('el token de subida no sirve para consultar el seguimiento', async () => {
    const { token } = await placeOrder();
    expect((await track(token)).status).toBe(404);
  });

  it('tokens inválidos, ajenos o con forma de UUID dan la misma respuesta (sin enumeración)', async () => {
    const { started } = await placeOrder();
    const jobId = (await w.db.query<any>(`select id from public.photo_jobs`))
      .rows[0].id as string;
    const responses = await Promise.all(
      [
        'x',
        '',
        jobId,
        'A'.repeat(43),
        started.body.destinations[0].destinationId,
        null,
        42,
        {},
      ].map((token) => track(token as string)),
    );
    for (const r of responses) {
      expect(r.status).toBe(404);
      expect(r.body).toMatchObject({
        error: 'Link inválido.',
        code: 'link_invalid',
      });
    }
  });

  it('un link de seguimiento revocado o vencido deja de funcionar', async () => {
    const { done } = await placeOrder();
    await w.db.query(
      `update public.photo_job_upload_links set revoked_at=now() where purpose='tracking'`,
    );
    const revoked = await track(done.body.trackingToken);
    expect(revoked.status).toBe(410);
    await w.db.query(
      `update public.photo_job_upload_links set revoked_at=null, expires_at='2020-01-01' where purpose='tracking'`,
    );
    expect((await track(done.body.trackingToken)).status).toBe(410);
  });

  it('revocar/regenerar el link de subida (flujo manual) no corta el seguimiento', async () => {
    const { done } = await placeOrder();
    await w.intake.revokeActiveLinks(
      IDS.business,
      (await w.db.query<any>(`select id from public.photo_jobs`)).rows[0].id,
    );
    expect((await track(done.body.trackingToken)).status).toBe(200);
  });

  it('un borrador no tiene seguimiento', async () => {
    const started = await start();
    expect((await track(started.body.uploadToken)).status).toBe(404);
  });
});

describe('aislamiento entre negocios', () => {
  it('el servicio de otro negocio no entra al pedido ni al catálogo', async () => {
    const { body } = await catalog();
    expect(body.services.map((s: any) => s.id)).not.toContain(
      IDS.svcOtherBusiness,
    );
  });

  it('un usuario de otro negocio no ve el pedido ni su consentimiento', async () => {
    await placeOrder();
    expect(await authenticatedCount(w.db, IDS.outsider, 'photo_jobs')).toBe(0);
    expect(
      await authenticatedCount(w.db, IDS.outsider, 'public_photo_orders'),
    ).toBe(0);
  });
});
