import { beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asRole,
  createDatabase,
  seedWorld,
  sqlMigrations,
  type Db,
} from './pg-harness';

let db: Db;
beforeAll(async () => {
  db = await createDatabase();
  await seedWorld(db);
}, 30_000);

describe('SERVICIOS-01 Cloud catalog', () => {
  it('crea los cuatro tamaños conocidos al migrar un negocio existente sin inventar tarifas', async () => {
    const old = await createDatabase({
      upTo: '20261018010000_whatsapp_notifications.sql',
    });
    await seedWorld(old);
    await old.exec(
      sqlMigrations().find(
        (x) => x.name === '20261024000000_service_catalog.sql',
      )!.sql,
    );
    const rows = await old.query<{
      width_mm: number;
      height_mm: number;
      paper: string;
      is_active: boolean;
    }>(
      `select s.width_mm,s.height_mm,v.paper,v.is_active from public.photo_services s
       join public.lab_variants v on v.business_id=s.business_id and v.photo_service_id=s.id
       where s.business_id=$1 and s.width_mm=150 and s.height_mm=210 order by v.paper`,
      [IDS.business],
    );
    expect(rows.rows).toEqual([
      { width_mm: 150, height_mm: 210, paper: 'glossy', is_active: false },
      { width_mm: 150, height_mm: 210, paper: 'matte', is_active: false },
    ]);
    const noRate = await old.query(
      `select id from public.lab_price_tiers where variant_id in (
      select v.id from public.lab_variants v join public.photo_services s on s.id=v.photo_service_id
      where s.business_id=$1 and s.width_mm=150 and s.height_mm=210)`,
      [IDS.business],
    );
    expect(noRate.rows).toEqual([]);
  }, 30_000);
  it('crea Público y Profesional por negocio y sólo importa los precios existentes como Brillo público', async () => {
    const lists = await db.query<{ kind: string; is_default: boolean }>(
      'select kind,is_default from public.price_lists where business_id=$1 order by kind',
      [IDS.business],
    );
    expect(lists.rows).toEqual([
      { kind: 'professional', is_default: false },
      { kind: 'public', is_default: true },
    ]);
    const tier = await db.query<{
      paper: string;
      channel: string;
      min_quantity: number;
      unit_price_cents: string;
    }>(
      `select v.paper,v.channel,t.min_quantity,t.unit_price_cents from public.lab_variants v
       join public.lab_price_tiers t on t.business_id=v.business_id and t.variant_id=v.id
       where v.photo_service_id=$1`,
      [IDS.svc10x15],
    );
    expect(tier.rows).toMatchObject([
      {
        paper: 'glossy',
        channel: 'laboratory',
        min_quantity: 1,
        unit_price_cents: 50000,
      },
    ]);
  });

  it('carga los importes de Plotter sólo en Profesional', async () => {
    const rows = await db.query<{
      kind: string;
      code: string;
      amount_cents: string;
    }>(
      `select l.kind,r.code,r.amount_cents from public.plotter_rates r
       join public.price_lists l on l.business_id=r.business_id and l.id=r.price_list_id
       where r.business_id=$1 and r.code='front_banner'`,
      [IDS.business],
    );
    expect(rows.rows).toEqual([
      { kind: 'professional', code: 'front_banner', amount_cents: 2550000 },
    ]);
  });

  it('staff no cambia la lista del cliente; owner sí', async () => {
    const customerId = '88888888-8888-4888-8888-888888888888';
    await db.query(
      'insert into public.customers(id,business_id,full_name) values($1,$2,$3)',
      [customerId, IDS.business, 'Cliente'],
    );
    const pro = (
      await db.query<{ id: string }>(
        `select id from public.price_lists where business_id=$1 and kind='professional'`,
        [IDS.business],
      )
    ).rows[0]!.id;
    await expect(
      asRole(db, 'authenticated', IDS.staff, () =>
        db.query('update public.customers set price_list_id=$1 where id=$2', [
          pro,
          customerId,
        ]),
      ),
    ).rejects.toThrow();
    await asRole(db, 'authenticated', IDS.owner, () =>
      db.query('update public.customers set price_list_id=$1 where id=$2', [
        pro,
        customerId,
      ]),
    );
    const saved = await db.query<{ price_list_id: string }>(
      'select price_list_id from public.customers where id=$1',
      [customerId],
    );
    expect(saved.rows[0]?.price_list_id).toBe(pro);
  });

  it('no permite tiers solapados y mantiene aislamiento RLS', async () => {
    const row = (
      await db.query<{ variant_id: string; price_list_id: string }>(
        `select t.variant_id,t.price_list_id from public.lab_price_tiers t
       join public.lab_variants v on v.id=t.variant_id where v.photo_service_id=$1`,
        [IDS.svc10x15],
      )
    ).rows[0]!;
    await expect(
      db.query(
        `insert into public.lab_price_tiers(business_id,variant_id,price_list_id,min_quantity,max_quantity,unit_price_cents)
       values($1,$2,$3,2,9,100)`,
        [IDS.business, row.variant_id, row.price_list_id],
      ),
    ).rejects.toThrow('LAB_TIER_OVERLAP');
    const other = await asRole(db, 'authenticated', IDS.outsider, () =>
      db.query('select id from public.plotter_rates where business_id=$1', [
        IDS.business,
      ]),
    );
    expect(other.rows).toEqual([]);
  });

  it('cotiza Mate con tier público, guarda snapshot y nunca usa Profesional por el teléfono', async () => {
    const listRows = await db.query<{ id: string; kind: string }>(
      'select id,kind from public.price_lists where business_id=$1',
      [IDS.business],
    );
    const publicId = listRows.rows.find((x) => x.kind === 'public')!.id;
    const proId = listRows.rows.find((x) => x.kind === 'professional')!.id;
    const variantId = '99999999-9999-4999-8999-999999999999';
    await db.query(
      `insert into public.lab_variants(id,business_id,photo_service_id,channel,paper)
      values($1,$2,$3,'laboratory','matte')`,
      [variantId, IDS.business, IDS.svc10x15],
    );
    await db.query(
      `insert into public.lab_price_tiers(business_id,variant_id,price_list_id,min_quantity,max_quantity,unit_price_cents)
      values($1,$2,$3,1,9,50000),($1,$2,$3,10,null,40000),($1,$2,$4,1,null,30000)`,
      [IDS.business, variantId, publicId, proId],
    );
    const catalog = await asRole(db, 'service_role', null, () =>
      db.query<{ result: unknown }>(
        'select public.cc_public_lab_catalog($1) result',
        [IDS.business],
      ),
    );
    const matte = (
      catalog.rows[0]!.result as Array<{
        id: string;
        name: string;
        tiers: Array<{ min_quantity: number }>;
      }>
    ).find((x) => x.id === variantId)!;
    expect(matte.name).toContain('Mate');
    expect(matte.tiers).toHaveLength(2);
    const start = async (price: number) =>
      asRole(db, 'service_role', null, () =>
        db.query<{
          result: {
            items: Array<{
              item_id: string;
              name: string;
              unit_price_cents: number;
            }>;
            total_cents: number;
            job_id: string;
            link_id: string;
          };
        }>(
          `select public.cc_public_order_start($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) result`,
          [
            IDS.business,
            'matte-client-key-123456',
            'Cliente Mate',
            '+5493425559876',
            '+54 9 342 555 9876',
            null,
            null,
            false,
            'ip-hash',
            JSON.stringify([
              {
                service_id: variantId,
                variant_id: variantId,
                quantity: 10,
                expected_unit_price_cents: price,
              },
            ]),
            'hash-matte',
            '2099-01-01T00:00:00Z',
          ],
        ),
      );
    await expect(start(30000)).rejects.toThrow('cc_error:price_changed');
    const started = (await start(40000)).rows[0]!.result;
    expect(started.total_cents).toBe(400000);
    expect(started.items[0]).toMatchObject({
      name: '10x15 · Mate · Público',
      unit_price_cents: 40000,
    });
    const snapshot = await db.query<{
      lab_variant_id: string;
      price_list_id: string;
    }>(
      'select lab_variant_id,price_list_id from public.photo_job_items where id=$1',
      [started.items[0]!.item_id],
    );
    expect(snapshot.rows[0]).toEqual({
      lab_variant_id: variantId,
      price_list_id: publicId,
    });
    await db.query(
      `insert into public.photo_job_files(business_id,photo_job_id,photo_job_item_id,
      drive_file_id,drive_folder_id,original_filename,stored_filename,size_bytes,copies,workflow_route,status)
      values($1,$2,$3,'drive-matte','folder','x.jpg','x.jpg',10,10,'lab','uploaded')`,
      [IDS.business, started.job_id, started.items[0]!.item_id],
    );
    const confirmed = await asRole(db, 'service_role', null, () =>
      db.query<{ result: { total_cents: number } }>(
        'select public.cc_public_order_confirm($1,$2,$3,$4,$5) result',
        [
          IDS.business,
          started.job_id,
          started.link_id,
          'hash-track-matte',
          '2099-01-01T00:00:00Z',
        ],
      ),
    );
    expect(confirmed.rows[0]!.result.total_cents).toBe(400000);
  });
});
