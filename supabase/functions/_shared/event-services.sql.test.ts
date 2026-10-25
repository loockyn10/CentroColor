import { beforeAll, describe, expect, it } from 'vitest';
import {
  asRole,
  createDatabase,
  IDS,
  seedWorld,
  sqlMigrations,
  type Db,
} from './pg-harness';

let db: Db;
const pool = '11111111-1111-4111-8111-111111111111';
const controllerA = 'a1111111-1111-4111-8111-111111111111';
const controllerB = 'b1111111-1111-4111-8111-111111111111';
const controllerC = 'c2222222-2222-4222-8222-222222222222';
const customer = 'c1111111-1111-4111-8111-111111111111';
const start = '2026-11-07T18:00:00Z';
const end = '2026-11-08T02:00:00Z';

beforeAll(async () => {
  db = await createDatabase();
  await seedWorld(db);
  await db.query(
    `insert into public.customers(id,business_id,full_name) values($1,$2,'LED Cliente')`,
    [customer, IDS.business],
  );
  await db.query(
    `insert into public.led_panel_pools(business_id,total_panels,panel_area_mm2,pixels_per_panel)
    values($1,24,500000,32768)`,
    [pool],
  );
  for (const id of [controllerA, controllerB, controllerC]) {
    await db.query(
      `insert into public.resources(id,business_id,name) values($1,$2,$3)`,
      [id, IDS.business, id],
    );
    await db.query(
      `insert into public.led_controllers(business_id,resource_id,max_pixels) values($1,$2,650000)`,
      [IDS.business, id],
    );
  }
}, 30_000);

let serial = 0;
async function event(
  withController: string,
  panels: number,
  from = start,
  to = end,
) {
  const id = `d1111111-1111-4111-8111-${String(++serial).padStart(12, '0')}`;
  const resourceId = `e1111111-1111-4111-8111-${String(serial).padStart(12, '0')}`;
  const panelId = `f1111111-1111-4111-8111-${String(serial).padStart(12, '0')}`;
  await asRole(db, 'authenticated', IDS.owner, () =>
    db.query(
      `insert into public.events(id,business_id,branch_id,customer_id,title,starts_at,ends_at,status,created_by)
    values($1,$2,$3,$4,'LED',$5,$6,'quoted',$7)`,
      [id, IDS.business, IDS.branch, customer, from, to, IDS.owner],
    ),
  );
  const itemId = `a2222222-2222-4222-8222-${String(serial).padStart(12, '0')}`;
  await db.query(
    `insert into public.event_service_items(id,business_id,event_id,name,quantity,unit_price_cents,total_cents,config_snapshot)
    values($1,$2,$3,'LED',1,0,0,'{"kind":"led_screen"}'::jsonb)`,
    [itemId, IDS.business, id],
  );
  await db.query(
    `insert into public.resource_reservations(id,business_id,event_id,resource_id,starts_at,ends_at,price_cents)
    values($1,$2,$3,$4,$5,$6,0)`,
    [resourceId, IDS.business, id, withController, from, to],
  );
  await db.query(
    `insert into public.led_panel_reservations(id,business_id,event_id,event_service_item_id,controller_resource_id,starts_at,ends_at,panels)
    values($1,$2,$3,$4,$5,$6,$7,$8)`,
    [panelId, IDS.business, id, itemId, withController, from, to, panels],
  );
  return id;
}

describe('LED cloud reservation guards', () => {
  it('siembra los recursos y el pool al migrar un CentroColor existente', async () => {
    const existing = await createDatabase({
      upTo: '20261024010000_public_lab_tiers.sql',
    });
    await seedWorld(existing);
    await existing.exec(
      sqlMigrations().find(
        (x) => x.name === '20261024020000_event_services.sql',
      )!.sql,
    );
    const result = await existing.query<{ total_panels: number }>(
      `select total_panels from public.led_panel_pools where business_id=$1`,
      [IDS.business],
    );
    expect(result.rows[0]?.total_panels).toBe(24);
    const resources = await existing.query<{ name: string }>(
      `select name from public.resources where business_id=$1 order by name`,
      [IDS.business],
    );
    expect(resources.rows.map((x) => x.name)).toContain('TB20 Plus');
  }, 30_000);
  it('reserva dos pantallas 3×2 con 24 paneles y controladores distintos; libera por fecha', async () => {
    const a = await event(controllerA, 12);
    const b = await event(controllerB, 12);
    await db.query(`update public.events set status='reserved' where id=$1`, [
      a,
    ]);
    await db.query(`update public.events set status='reserved' where id=$1`, [
      b,
    ]);
    const after = await event(
      controllerA,
      12,
      '2026-11-09T18:00:00Z',
      '2026-11-10T02:00:00Z',
    );
    await db.query(`update public.events set status='reserved' where id=$1`, [
      after,
    ]);
    expect(
      (
        await db.query(
          `select count(*) n from public.events where status='reserved'`,
        )
      ).rows[0],
    ).toMatchObject({ n: 3 });
  });

  it('rechaza exceso de paneles, controlador ocupado y controlador insuficiente al reservar', async () => {
    const over = await event(controllerA, 1);
    await expect(
      db.query(`update public.events set status='reserved' where id=$1`, [
        over,
      ]),
    ).rejects.toThrow('LED_POOL_CAPACITY_CONFLICT');
    await db.query(`update public.events set status='cancelled' where id=$1`, [
      over,
    ]);
    const other = await event(
      controllerA,
      1,
      '2026-11-12T18:00:00Z',
      '2026-11-13T02:00:00Z',
    );
    await db.query(`update public.events set status='reserved' where id=$1`, [
      other,
    ]);
    const occupied = await event(
      controllerA,
      1,
      '2026-11-12T19:00:00Z',
      '2026-11-13T01:00:00Z',
    );
    await expect(
      db.query(`update public.events set status='reserved' where id=$1`, [
        occupied,
      ]),
    ).rejects.toThrow('LED_CONTROLLER_CONFLICT');
    const large = await event(
      controllerB,
      21,
      '2026-11-15T18:00:00Z',
      '2026-11-16T02:00:00Z',
    );
    await expect(
      db.query(`update public.events set status='reserved' where id=$1`, [
        large,
      ]),
    ).rejects.toThrow('LED_CONTROLLER_REQUIRED');
  });

  it('no confirma una línea LED sin paneles y distingue reservas sucesivas', async () => {
    const gap = await event(
      controllerA,
      12,
      '2026-11-20T18:00:00Z',
      '2026-11-20T20:00:00Z',
    );
    await db.query(
      'delete from public.led_panel_reservations where event_id=$1',
      [gap],
    );
    await expect(
      db.query(`update public.events set status='reserved' where id=$1`, [gap]),
    ).rejects.toThrow('LED_PANEL_RESERVATION_REQUIRED');
    const early = await event(
      controllerA,
      12,
      '2026-11-21T18:00:00Z',
      '2026-11-21T20:00:00Z',
    );
    const late = await event(
      controllerB,
      12,
      '2026-11-21T22:00:00Z',
      '2026-11-22T00:00:00Z',
    );
    const broad = await event(
      controllerC,
      12,
      '2026-11-21T18:00:00Z',
      '2026-11-22T00:00:00Z',
    );
    await db.query(`update public.events set status='reserved' where id=$1`, [
      early,
    ]);
    await db.query(`update public.events set status='reserved' where id=$1`, [
      late,
    ]);
    await db.query(`update public.events set status='reserved' where id=$1`, [
      broad,
    ]);
  });
  it('serializa cada confirmación LED con un lock transaccional del pool', async () => {
    const id = await event(
      controllerC,
      2,
      '2026-12-05T18:00:00Z',
      '2026-12-06T02:00:00Z',
    );
    const key = `select hashtextextended($1::text||':LED_POOL',0) k`;
    const held = async (tx: Pick<Db, 'query'>) =>
      (
        await tx.query<{ n: number }>(
          `with k as (${key})
          select count(*)::int n from pg_locks l, k
          where l.locktype='advisory' and l.pid=pg_backend_pid()
            and l.classid=((k.k>>32)&4294967295)::oid and l.objid=(k.k&4294967295)::oid`,
          [IDS.business],
        )
      ).rows[0]?.n;
    await db.transaction(async (tx) => {
      await tx.query(`update public.events set status='reserved' where id=$1`, [
        id,
      ]);
      expect(await held(tx)).toBe(1);
    });
    expect(await held(db)).toBe(0);
  });

  it('un recurso exclusivo no se alquila dos veces en la misma fecha', async () => {
    const booth = 'b2222222-2222-4222-8222-222222222222';
    await db.query(
      `insert into public.resources(id,business_id,name) values($1,$2,'Cabina exclusiva')`,
      [booth, IDS.business],
    );
    const first = await event(
      controllerC,
      1,
      '2026-12-10T18:00:00Z',
      '2026-12-11T02:00:00Z',
    );
    const second = await event(
      controllerB,
      1,
      '2026-12-10T20:00:00Z',
      '2026-12-11T00:00:00Z',
    );
    for (const [index, eventId] of [first, second].entries())
      await db.query(
        `insert into public.resource_reservations(id,business_id,event_id,resource_id,starts_at,ends_at,price_cents)
        values($1,$2,$3,$4,'2026-12-10T20:00:00Z','2026-12-10T22:00:00Z',0)`,
        [
          `b3333333-3333-4333-8333-00000000000${index}`,
          IDS.business,
          eventId,
          booth,
        ],
      );
    await db.query(`update public.events set status='reserved' where id=$1`, [
      first,
    ]);
    await expect(
      db.query(`update public.events set status='reserved' where id=$1`, [
        second,
      ]),
    ).rejects.toThrow('RESOURCE_RESERVATION_CONFLICT');
  });

  it('no permite bajar la capacidad configurada por debajo de las reservas vigentes', async () => {
    await expect(
      db.query(
        `update public.led_panel_pools set total_panels=23 where business_id=$1`,
        [IDS.business],
      ),
    ).rejects.toThrow('LED_POOL_BELOW_RESERVED_CAPACITY');
    await expect(
      db.query(
        `update public.led_controllers set max_pixels=1000 where business_id=$1 and resource_id=$2`,
        [IDS.business, controllerA],
      ),
    ).rejects.toThrow('LED_CONTROLLER_BELOW_RESERVED_PIXELS');
  });
});
