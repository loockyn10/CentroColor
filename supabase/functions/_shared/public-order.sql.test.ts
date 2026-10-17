/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows and JSON bodies are untyped in tests. */
// Runs the shipped Sprint 14 SQL (migrations 20261018*) on a real PostgreSQL (PGlite):
// the RPCs, constraints, RLS and triggers that the Edge Functions rely on.
import { beforeEach, describe, expect, it } from 'vitest';
import { IDS, asRole, createDatabase, seedWorld, type Db } from './pg-harness';

const KEY_A = 'client-key-aaaaaaaaaaaa';
const KEY_B = 'client-key-bbbbbbbbbbbb';
const PHONE = '+5493425551234';
const TOKEN_1 = 'hash-upload-1';
const TOKEN_2 = 'hash-upload-2';
const LATER = '2099-01-01T00:00:00Z';

type Line = {
  service_id: string;
  quantity: number;
  expected_unit_price_cents: number;
};
const line = (service_id: string, quantity: number, price: number): Line => ({
  service_id,
  quantity,
  expected_unit_price_cents: price,
});
const TEN = line(IDS.svc10x15, 3, 50000);
const TWENTY = line(IDS.svc20x30, 1, 250000);

let db: Db;

async function start(
  overrides: Partial<{
    key: string;
    name: string;
    phone: string;
    display: string;
    email: string | null;
    notes: string | null;
    optIn: boolean;
    items: Line[];
    tokenHash: string;
    business: string;
  }> = {},
) {
  const o = {
    key: KEY_A,
    name: 'María García',
    phone: PHONE,
    display: '+54 9 342 555 1234',
    email: null,
    notes: null,
    optIn: true,
    items: [TEN, TWENTY],
    tokenHash: TOKEN_1,
    business: IDS.business,
    ...overrides,
  };
  return asRole(db, 'service_role', null, async () => {
    const result = await db.query<{ r: any }>(
      `select public.cc_public_order_start($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) r`,
      [
        o.business,
        o.key,
        o.name,
        o.phone,
        o.display,
        o.email,
        o.notes,
        o.optIn,
        'iphash',
        JSON.stringify(o.items),
        o.tokenHash,
        LATER,
      ],
    );
    return result.rows[0]!.r;
  });
}

async function addUploadedFile(
  jobId: string,
  itemId: string,
  copies: number,
  status = 'uploaded',
) {
  await db.query(
    `insert into public.photo_job_files(business_id, photo_job_id, photo_job_item_id, drive_file_id, drive_folder_id,
       original_filename, stored_filename, size_bytes, copies, workflow_route, status)
     values ($1,$2,$3,$4,'folder','a.jpg','x-a.jpg',10,$5,'lab',$6)`,
    [IDS.business, jobId, itemId, `drive-${Math.random()}`, copies, status],
  );
}

async function confirm(jobId: string, linkId: string, hash = 'hash-track-1') {
  return asRole(db, 'service_role', null, async () => {
    const result = await db.query<{ r: any }>(
      `select public.cc_public_order_confirm($1,$2,$3,$4,$5) r`,
      [IDS.business, jobId, linkId, hash, LATER],
    );
    return result.rows[0]!.r;
  });
}

beforeEach(async () => {
  db = await createDatabase();
  await seedWorld(db);
});

describe('catálogo público sobre PhotoService', () => {
  it('public_order_enabled exige público + laboratorio + archivos del cliente', async () => {
    await expect(
      db.query(`update public.photo_services set is_public=false where id=$1`, [
        IDS.svc10x15,
      ]),
    ).rejects.toThrow(/public_order_requires_lab/);
    await expect(
      db.query(
        `update public.photo_services set workflow_route='editing' where id=$1`,
        [IDS.svc10x15],
      ),
    ).rejects.toThrow(/public_order_requires_lab/);
  });
});

describe('cc_public_order_start', () => {
  it('crea Customer + PhotoJob draft + items con snapshot del catálogo + link, en una transacción', async () => {
    const r = await start();
    expect(r.status).toBe('draft');
    expect(r.total_cents).toBe(3 * 50000 + 250000);
    expect(r.items).toHaveLength(2);
    const job = (
      await db.query<any>(`select * from public.photo_jobs where id=$1`, [
        r.job_id,
      ])
    ).rows[0];
    expect(job).toMatchObject({
      is_draft: true,
      source_channel: 'public_web',
      status: 'received',
      file_intake_status: 'awaiting_files',
      branch_id: IDS.branch,
      created_by: IDS.owner,
    });
    const items = (
      await db.query<any>(
        `select service_name_snapshot n, quantity q, unit_price_cents p, total_cents t from public.photo_job_items where photo_job_id=$1 order by p`,
        [r.job_id],
      )
    ).rows;
    expect(items).toEqual([
      { n: '10x15', q: 3, p: 50000, t: 150000 },
      { n: '20x30', q: 1, p: 250000, t: 250000 },
    ]);
    const customer = (
      await db.query<any>(`select * from public.customers where id=$1`, [
        r.customer_id,
      ])
    ).rows[0];
    expect(customer).toMatchObject({
      full_name: 'María García',
      phone: '+54 9 342 555 1234',
      business_id: IDS.business,
    });
    const order = (
      await db.query<any>(
        `select * from public.public_photo_orders where photo_job_id=$1`,
        [r.job_id],
      )
    ).rows[0];
    expect(order).toMatchObject({
      status: 'draft',
      whatsapp_e164: PHONE,
      whatsapp_opt_in: true,
      consent_source: 'public_order',
    });
    expect(order.whatsapp_opt_in_at).not.toBeNull();
    const links = (
      await db.query<any>(
        `select purpose, token_hash, created_by from public.photo_job_upload_links where photo_job_id=$1`,
        [r.job_id],
      )
    ).rows;
    expect(links).toEqual([
      { purpose: 'upload', token_hash: TOKEN_1, created_by: null },
    ]);
  });

  it('sin opt-in no guarda timestamp de consentimiento', async () => {
    const r = await start({ optIn: false });
    const order = (
      await db.query<any>(
        `select whatsapp_opt_in, whatsapp_opt_in_at from public.public_photo_orders where photo_job_id=$1`,
        [r.job_id],
      )
    ).rows[0];
    expect(order).toEqual({ whatsapp_opt_in: false, whatsapp_opt_in_at: null });
  });

  it('repetir con la misma clave NO duplica job, items ni customer y rota el link', async () => {
    const first = await start();
    const second = await start({ tokenHash: TOKEN_2 });
    expect(second.job_id).toBe(first.job_id);
    expect(second.order_id).toBe(first.order_id);
    expect(second.customer_id).toBe(first.customer_id);
    expect(
      (await db.query<any>(`select count(*)::int n from public.photo_jobs`))
        .rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.query<any>(
          `select count(*)::int n from public.photo_job_items`,
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (await db.query<any>(`select count(*)::int n from public.customers`))
        .rows[0].n,
    ).toBe(1);
    const links = (
      await db.query<any>(
        `select token_hash, revoked_at is not null revoked from public.photo_job_upload_links order by created_at, id`,
      )
    ).rows;
    expect(links).toEqual([
      { token_hash: TOKEN_1, revoked: true },
      { token_hash: TOKEN_2, revoked: false },
    ]);
  });

  it('un refresh puede cambiar copias y servicios; el que se quita sin archivos deja de contar', async () => {
    const first = await start();
    const second = await start({
      tokenHash: TOKEN_2,
      items: [line(IDS.svc10x15, 5, 50000), line(IDS.svc13x18, 2, 80000)],
    });
    expect(second.total_cents).toBe(5 * 50000 + 2 * 80000);
    const active = (
      await db.query<any>(
        `select service_name_snapshot n, is_active a from public.photo_job_items where photo_job_id=$1 order by n`,
        [first.job_id],
      )
    ).rows;
    expect(active).toEqual([
      { n: '10x15', a: true },
      { n: '13x18', a: true },
      { n: '20x30', a: false },
    ]);
  });

  it('reutiliza el Customer del negocio con el mismo teléfono sin modificarlo', async () => {
    await db.query(
      `insert into public.customers(id, business_id, full_name, phone, email) values (gen_random_uuid(), $1, 'Cliente histórico', '0342 555-1234', 'viejo@example.com')`,
      [IDS.business],
    );
    const r = await start();
    expect(
      (await db.query<any>(`select count(*)::int n from public.customers`))
        .rows[0].n,
    ).toBe(1);
    const customer = (
      await db.query<any>(
        `select full_name, phone, email from public.customers where id=$1`,
        [r.customer_id],
      )
    ).rows[0];
    expect(customer).toEqual({
      full_name: 'Cliente histórico',
      phone: '0342 555-1234',
      email: 'viejo@example.com',
    });
  });

  it('no reutiliza ni expone un Customer de otro negocio con el mismo teléfono', async () => {
    await db.query(
      `insert into public.customers(id, business_id, full_name, phone) values (gen_random_uuid(), $1, 'Ajeno', '+54 9 342 555 1234')`,
      [IDS.otherBusiness],
    );
    const r = await start();
    const customer = (
      await db.query<any>(
        `select business_id, full_name from public.customers where id=$1`,
        [r.customer_id],
      )
    ).rows[0];
    expect(customer).toEqual({
      business_id: IDS.business,
      full_name: 'María García',
    });
  });

  it('un teléfono distinto crea otro Customer', async () => {
    await start();
    await start({
      key: KEY_B,
      phone: '+5493515550000',
      display: '+54 9 351 555 0000',
      name: 'Otro',
      tokenHash: TOKEN_2,
    });
    expect(
      (await db.query<any>(`select count(*)::int n from public.customers`))
        .rows[0].n,
    ).toBe(2);
  });

  it('rechaza precios manipulados: el cliente sólo declara el precio que vio', async () => {
    await expect(start({ items: [line(IDS.svc10x15, 3, 1)] })).rejects.toThrow(
      'cc_error:price_changed',
    );
    expect(
      (await db.query<any>(`select count(*)::int n from public.photo_jobs`))
        .rows[0].n,
    ).toBe(0);
    expect(
      (await db.query<any>(`select count(*)::int n from public.customers`))
        .rows[0].n,
    ).toBe(0);
  });

  it('rechaza servicios no públicos, de otro negocio, inactivos o duplicados', async () => {
    await expect(
      start({ items: [line(IDS.svcPrivate, 1, 900000)] }),
    ).rejects.toThrow('cc_error:service_unavailable');
    await expect(
      start({ items: [line(IDS.svcOtherBusiness, 1, 1)] }),
    ).rejects.toThrow('cc_error:service_unavailable');
    await db.query(
      `update public.photo_services set is_active=false where id=$1`,
      [IDS.svc13x18],
    );
    await expect(
      start({ items: [line(IDS.svc13x18, 1, 80000)] }),
    ).rejects.toThrow('cc_error:service_unavailable');
    await expect(start({ items: [TEN, TEN] })).rejects.toThrow(
      'cc_error:invalid_items',
    );
  });

  it('valida cantidades, teléfono y clave', async () => {
    await expect(
      start({ items: [line(IDS.svc10x15, 0, 50000)] }),
    ).rejects.toThrow('cc_error:invalid_quantity');
    await expect(
      start({ items: [line(IDS.svc10x15, 1001, 50000)] }),
    ).rejects.toThrow('cc_error:invalid_quantity');
    await expect(start({ phone: '3425551234' })).rejects.toThrow(
      'cc_error:invalid_phone',
    );
    await expect(start({ key: 'short' })).rejects.toThrow(
      'cc_error:invalid_request',
    );
  });

  it('un pedido ya enviado no se reabre con la misma clave', async () => {
    const r = await start();
    const itemId = r.items[0].item_id;
    await addUploadedFile(r.job_id, itemId, 3);
    await confirm(r.job_id, r.link_id);
    const again = await start({ tokenHash: TOKEN_2 });
    expect(again).toMatchObject({ status: 'submitted', job_id: r.job_id });
    expect(
      (
        await db.query<any>(
          `select count(*)::int n from public.photo_job_upload_links where purpose='upload'`,
        )
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('borradores invisibles para Producción, Trabajos y Desktop', () => {
  it('authenticated no ve el job, sus items ni sus archivos mientras es borrador', async () => {
    const r = await start();
    await addUploadedFile(r.job_id, r.items[0].item_id, 1);
    const counts = await asRole(db, 'authenticated', IDS.staff, async () => ({
      jobs: (
        await db.query<any>(`select count(*)::int n from public.photo_jobs`)
      ).rows[0].n,
      items: (
        await db.query<any>(
          `select count(*)::int n from public.photo_job_items`,
        )
      ).rows[0].n,
      files: (
        await db.query<any>(
          `select count(*)::int n from public.photo_job_files`,
        )
      ).rows[0].n,
      orders: (
        await db.query<any>(
          `select count(*)::int n from public.public_photo_orders`,
        )
      ).rows[0].n,
    }));
    expect(counts).toEqual({ jobs: 0, items: 0, files: 0, orders: 0 });
    const server = await asRole(
      db,
      'service_role',
      null,
      async () =>
        (await db.query<any>(`select count(*)::int n from public.photo_jobs`))
          .rows[0].n,
    );
    expect(server).toBe(1);
  });

  it('un miembro no puede modificar un borrador ni marcarlo como confirmado', async () => {
    const r = await start();
    const changed = await asRole(
      db,
      'authenticated',
      IDS.staff,
      async () =>
        (
          await db.query<any>(
            `update public.photo_jobs set is_draft=false where id=$1 returning id`,
            [r.job_id],
          )
        ).rows,
    );
    expect(changed).toEqual([]);
    expect(
      (
        await db.query<any>(
          `select is_draft from public.photo_jobs where id=$1`,
          [r.job_id],
        )
      ).rows[0].is_draft,
    ).toBe(true);
  });

  it('un miembro no puede crear jobs web ni borradores directamente', async () => {
    const r = await start();
    const attempt = (sql: string) =>
      asRole(db, 'authenticated', IDS.staff, () =>
        db.query(sql, [IDS.business, IDS.branch, r.customer_id, IDS.staff]),
      );
    await expect(
      attempt(
        `insert into public.photo_jobs(id,business_id,branch_id,customer_id,status,created_by,source_channel) values (gen_random_uuid(),$1,$2,$3,'received',$4,'public_web')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      attempt(
        `insert into public.photo_jobs(id,business_id,branch_id,customer_id,status,created_by,is_draft,source_channel) values (gen_random_uuid(),$1,$2,$3,'received',$4,true,'public_web')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('los jobs manuales siguen funcionando igual (source_channel por defecto)', async () => {
    await db.query(
      `insert into public.customers(id,business_id,full_name) values ('c0000000-0000-4000-8000-000000000001',$1,'Manual')`,
      [IDS.business],
    );
    await asRole(db, 'authenticated', IDS.staff, () =>
      db.query(
        `insert into public.photo_jobs(id,business_id,branch_id,customer_id,status,created_by) values (gen_random_uuid(),$1,$2,'c0000000-0000-4000-8000-000000000001','received',$3)`,
        [IDS.business, IDS.branch, IDS.staff],
      ),
    );
    const seen = await asRole(
      db,
      'authenticated',
      IDS.staff,
      async () =>
        (
          await db.query<any>(
            `select source_channel, is_draft from public.photo_jobs`,
          )
        ).rows,
    );
    expect(seen).toEqual([{ source_channel: 'manual', is_draft: false }]);
  });
});

describe('cc_public_order_confirm', () => {
  async function ready() {
    const r = await start();
    const [ten, twenty] = r.items as { item_id: string; name: string }[];
    return { r, ten: ten!.item_id, twenty: twenty!.item_id };
  }

  it('deriva la cantidad de cada item de sum(copies) de sus archivos y congela el snapshot', async () => {
    const { r, ten, twenty } = await ready();
    await addUploadedFile(r.job_id, ten, 2);
    await addUploadedFile(r.job_id, ten, 1);
    await addUploadedFile(r.job_id, twenty, 1);
    await addUploadedFile(r.job_id, ten, 7, 'failed');
    const out = await confirm(r.job_id, r.link_id);
    expect(out).toMatchObject({
      status: 'submitted',
      already_submitted: false,
      total_cents: 3 * 50000 + 250000,
    });
    const items = (
      await db.query<any>(
        `select service_name_snapshot n, quantity q, total_cents t, unit_price_cents p from public.photo_job_items where photo_job_id=$1 order by p`,
        [r.job_id],
      )
    ).rows;
    expect(items).toEqual([
      { n: '10x15', q: 3, t: 150000, p: 50000 },
      { n: '20x30', q: 1, t: 250000, p: 250000 },
    ]);
  });

  it('una cantidad pedida distinta de las copias subidas se corrige por los archivos', async () => {
    const { r, ten, twenty } = await ready();
    await addUploadedFile(r.job_id, ten, 5);
    await addUploadedFile(r.job_id, twenty, 2);
    const out = await confirm(r.job_id, r.link_id);
    expect(out.total_cents).toBe(5 * 50000 + 2 * 250000);
  });

  it('un servicio sin archivos queda inactivo y no suma', async () => {
    const { r, ten } = await ready();
    await addUploadedFile(r.job_id, ten, 2);
    const out = await confirm(r.job_id, r.link_id);
    expect(out.total_cents).toBe(2 * 50000);
    expect(out.items).toHaveLength(1);
  });

  it('el job sale de borrador, entra a Producción y se vuelve visible para los miembros', async () => {
    const { r, ten } = await ready();
    await addUploadedFile(r.job_id, ten, 2);
    await confirm(r.job_id, r.link_id);
    const job = (
      await db.query<any>(
        `select is_draft, status, file_intake_status, source_channel from public.photo_jobs where id=$1`,
        [r.job_id],
      )
    ).rows[0];
    expect(job).toEqual({
      is_draft: false,
      status: 'received',
      file_intake_status: 'submitted',
      source_channel: 'public_web',
    });
    const seen = await asRole(db, 'authenticated', IDS.staff, async () => ({
      jobs: (
        await db.query<any>(`select count(*)::int n from public.photo_jobs`)
      ).rows[0].n,
      files: (
        await db.query<any>(
          `select count(*)::int n from public.photo_job_files`,
        )
      ).rows[0].n,
      orders: (
        await db.query<any>(
          `select count(*)::int n from public.public_photo_orders`,
        )
      ).rows[0].n,
    }));
    expect(seen).toEqual({ jobs: 1, files: 1, orders: 1 });
  });

  it('el snapshot de precio no cambia aunque el catálogo suba después', async () => {
    const { r, ten } = await ready();
    await addUploadedFile(r.job_id, ten, 2);
    await confirm(r.job_id, r.link_id);
    await db.query(
      `update public.photo_services set default_unit_price_cents=99999 where id=$1`,
      [IDS.svc10x15],
    );
    const item = (
      await db.query<any>(
        `select unit_price_cents p from public.photo_job_items where photo_job_id=$1 and is_active`,
        [r.job_id],
      )
    ).rows[0];
    expect(item.p).toBe(50000);
  });

  it('es idempotente: confirmar dos veces no duplica nada y emite otro link de seguimiento', async () => {
    const { r, ten } = await ready();
    await addUploadedFile(r.job_id, ten, 2);
    const first = await confirm(r.job_id, r.link_id, 'hash-track-1');
    const second = await confirm(r.job_id, r.link_id, 'hash-track-2');
    expect(second.already_submitted).toBe(true);
    expect(second.total_cents).toBe(first.total_cents);
    expect(
      (await db.query<any>(`select count(*)::int n from public.photo_jobs`))
        .rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.query<any>(
          `select count(*)::int n from public.photo_job_items where is_active`,
        )
      ).rows[0].n,
    ).toBe(1);
    const tracking = (
      await db.query<any>(
        `select token_hash, submitted_at is not null s from public.photo_job_upload_links where purpose='tracking' order by token_hash`,
      )
    ).rows;
    expect(tracking).toEqual([
      { token_hash: 'hash-track-1', s: true },
      { token_hash: 'hash-track-2', s: true },
    ]);
  });

  it('no confirma con cargas pendientes ni sin archivos', async () => {
    const { r, ten } = await ready();
    await expect(confirm(r.job_id, r.link_id)).rejects.toThrow(
      'cc_error:no_files',
    );
    await addUploadedFile(r.job_id, ten, 1, 'uploading');
    await expect(confirm(r.job_id, r.link_id)).rejects.toThrow(
      'cc_error:uploads_pending',
    );
    expect(
      (
        await db.query<any>(
          `select is_draft from public.photo_jobs where id=$1`,
          [r.job_id],
        )
      ).rows[0].is_draft,
    ).toBe(true);
  });

  it('cierra el link de subida y no cambia el job de otro negocio', async () => {
    const { r, ten } = await ready();
    await addUploadedFile(r.job_id, ten, 1);
    await confirm(r.job_id, r.link_id);
    const upload = (
      await db.query<any>(
        `select submitted_at is not null s from public.photo_job_upload_links where purpose='upload'`,
      )
    ).rows[0];
    expect(upload.s).toBe(true);
    await expect(
      asRole(db, 'service_role', null, () =>
        db.query(`select public.cc_public_order_confirm($1,$2,$3,'h',$4)`, [
          IDS.otherBusiness,
          r.job_id,
          r.link_id,
          LATER,
        ]),
      ),
    ).rejects.toThrow('cc_error:order_not_found');
  });
});

describe('abandono', () => {
  it('marca borradores viejos como abandonados sin borrar nada y revoca su link de subida', async () => {
    const r = await start();
    await db.query(
      `update public.public_photo_orders set updated_at = now() - interval '40 days'`,
    );
    const count = await asRole(
      db,
      'service_role',
      null,
      async () =>
        (
          await db.query<any>(
            `select public.cc_public_order_mark_abandoned(interval '30 days') n`,
          )
        ).rows[0].n,
    );
    expect(count).toBe(1);
    expect(
      (await db.query<any>(`select status from public.public_photo_orders`))
        .rows[0].status,
    ).toBe('abandoned');
    expect(
      (
        await db.query<any>(
          `select count(*)::int n from public.photo_jobs where id=$1`,
          [r.job_id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.query<any>(
          `select revoked_at is not null r from public.photo_job_upload_links`,
        )
      ).rows[0].r,
    ).toBe(true);
    // Sigue oculto y puede retomarse con la misma clave.
    const again = await start({ tokenHash: TOKEN_2 });
    expect(again.status).toBe('draft');
    expect(
      (await db.query<any>(`select status from public.public_photo_orders`))
        .rows[0].status,
    ).toBe('draft');
  });

  it('no abandona borradores recientes ni acepta ventanas menores a un día', async () => {
    await start();
    const count = await asRole(
      db,
      'service_role',
      null,
      async () =>
        (
          await db.query<any>(
            `select public.cc_public_order_mark_abandoned(interval '30 days') n`,
          )
        ).rows[0].n,
    );
    expect(count).toBe(0);
    await expect(
      asRole(db, 'service_role', null, () =>
        db.query(
          `select public.cc_public_order_mark_abandoned(interval '1 minute')`,
        ),
      ),
    ).rejects.toThrow('cc_error:invalid_request');
  });
});

describe('privilegios', () => {
  it('anon y authenticated no pueden ejecutar los RPC server-only', async () => {
    for (const role of ['anon', 'authenticated'] as const)
      await expect(
        asRole(db, role, IDS.staff, () =>
          db.query(
            `select public.cc_public_order_mark_abandoned(interval '30 days')`,
          ),
        ),
      ).rejects.toThrow(/permission denied/);
  });

  it('anon no lee ninguna tabla del pedido público', async () => {
    for (const table of [
      'public_photo_orders',
      'photo_job_upload_links',
      'photo_jobs',
      'customers',
    ])
      await expect(
        asRole(db, 'anon', null, () =>
          db.query(`select 1 from public.${table}`),
        ),
      ).rejects.toThrow(/permission denied/);
  });

  it('los miembros leen el consentimiento pero no la clave idempotente ni el hash de IP', async () => {
    const r = await start();
    await addUploadedFile(r.job_id, r.items[0].item_id, 1);
    await confirm(r.job_id, r.link_id);
    const row = await asRole(
      db,
      'authenticated',
      IDS.staff,
      async () =>
        (
          await db.query<any>(
            `select whatsapp_e164, whatsapp_opt_in, status from public.public_photo_orders`,
          )
        ).rows[0],
    );
    expect(row).toEqual({
      whatsapp_e164: PHONE,
      whatsapp_opt_in: true,
      status: 'submitted',
    });
    await expect(
      asRole(db, 'authenticated', IDS.staff, () =>
        db.query(`select client_key from public.public_photo_orders`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, 'authenticated', IDS.staff, () =>
        db.query(`select client_ip_hash from public.public_photo_orders`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('un usuario de otro negocio no ve nada', async () => {
    const r = await start();
    await addUploadedFile(r.job_id, r.items[0].item_id, 1);
    await confirm(r.job_id, r.link_id);
    const n = await asRole(
      db,
      'authenticated',
      IDS.outsider,
      async () =>
        (await db.query<any>(`select count(*)::int n from public.photo_jobs`))
          .rows[0].n,
    );
    expect(n).toBe(0);
  });
});
