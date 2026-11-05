import { beforeAll, describe, expect, it } from 'vitest';
import { IDS, asRole, createDatabase, seedWorld, type Db } from './pg-harness';

/**
 * Papelera de catálogos (20261105000000_catalog_trash.sql): eliminar es reversible y distinto de
 * «inactivo», respeta los permisos de cada catálogo y no rompe el historial.
 */
let db: Db;
const id = (n: number) =>
  `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const asOwner = <T>(work: () => Promise<T>) =>
  asRole(db, 'authenticated', IDS.owner, work);
const asStaff = <T>(work: () => Promise<T>) =>
  asRole(db, 'authenticated', IDS.staff, work);
const asOutsider = <T>(work: () => Promise<T>) =>
  asRole(db, 'authenticated', IDS.outsider, work);

const trash = (table: string, rowId: string) =>
  db.query(
    `update public.${table} set deleted_at = now() where id = $1 and deleted_at is null`,
    [rowId],
  );
const restore = (table: string, rowId: string) =>
  db.query(
    `update public.${table} set deleted_at = null where id = $1 and deleted_at is not null`,
    [rowId],
  );
const row = async (table: string, rowId: string) =>
  (
    await db.query<{
      is_active: boolean;
      deleted_at: string | null;
      updated_at: string;
    }>(
      `select is_active, deleted_at, updated_at from public.${table} where id=$1`,
      [rowId],
    )
  ).rows[0]!;

beforeAll(async () => {
  db = await createDatabase();
  await seedWorld(db);
  await asOwner(async () => {
    await db.query(
      `insert into public.product_categories(id,business_id,name) values($1,$2,'Marcos')`,
      [id(1), IDS.business],
    );
    await db.query(
      `insert into public.products(id,business_id,name,barcode,sale_price_cents,category_id)
       values($1,$2,'Producto prueba 123','777',1500,$3)`,
      [id(2), IDS.business, id(1)],
    );
    await db.query(
      `insert into public.appointment_types(id,business_id,name,default_duration_minutes) values($1,$2,'Retiro',15)`,
      [id(3), IDS.business],
    );
    await db.query(
      `insert into public.event_types(id,business_id,name) values($1,$2,'Casamiento')`,
      [id(4), IDS.business],
    );
    await db.query(
      `insert into public.resources(id,business_id,name) values($1,$2,'Proyector')`,
      [id(5), IDS.business],
    );
    await db.query(
      `insert into public.frame_mouldings(id,business_id,name,cost_per_meter_cents) values($1,$2,'Roble',1000)`,
      [id(6), IDS.business],
    );
    await db.query(
      `insert into public.frame_materials(id,business_id,name,material_type,pricing_unit,cost_cents)
       values($1,$2,'Vidrio 2 mm','glass','square_meter',500)`,
      [id(7), IDS.business],
    );
  });
}, 30_000);

describe('Papelera de catálogos — Cloud', () => {
  it('todos los catálogos nacen sin eliminar', async () => {
    for (const [table, n] of [
      ['product_categories', 1],
      ['products', 2],
      ['appointment_types', 3],
      ['event_types', 4],
      ['resources', 5],
      ['frame_mouldings', 6],
      ['frame_materials', 7],
    ] as const) {
      expect((await row(table, id(n))).deleted_at).toBeNull();
    }
  });

  it('eliminar no cambia «activo» (eliminado ≠ inactivo) y avanza la versión del sync', async () => {
    const before = await row('products', id(2));
    await asOwner(() => trash('products', id(2)));
    const after = await row('products', id(2));
    expect(after.deleted_at).not.toBeNull();
    expect(after.is_active).toBe(true);
    expect(after.updated_at > before.updated_at).toBe(true);
    // Un listado normal (sin eliminados) ya no lo ve; uno inactivo sí seguiría viéndose.
    const live = await db.query(
      `select id from public.products where business_id=$1 and deleted_at is null`,
      [IDS.business],
    );
    expect(live.rows).toEqual([]);
  });

  it('restaurar lo devuelve con el mismo estado activo y otra versión', async () => {
    const before = await row('products', id(2));
    await asOwner(() => restore('products', id(2)));
    const after = await row('products', id(2));
    expect(after.deleted_at).toBeNull();
    expect(after.is_active).toBe(true);
    expect(after.updated_at > before.updated_at).toBe(true);
  });

  it('un producto inactivo no está en la Papelera y uno eliminado no está «inactivo»', async () => {
    await asOwner(() =>
      db.query(`update public.products set is_active=false where id=$1`, [
        id(2),
      ]),
    );
    expect(await row('products', id(2))).toMatchObject({
      is_active: false,
      deleted_at: null,
    });
    await asOwner(() => trash('products', id(2)));
    expect(await row('products', id(2))).toMatchObject({ is_active: false });
    expect((await row('products', id(2))).deleted_at).not.toBeNull();
    // Restaurar devuelve el estado previo: sigue inactivo (no se reactiva solo).
    await asOwner(() => restore('products', id(2)));
    expect(await row('products', id(2))).toMatchObject({
      is_active: false,
      deleted_at: null,
    });
    await asOwner(() =>
      db.query(`update public.products set is_active=true where id=$1`, [
        id(2),
      ]),
    );
  });

  it('el código de barras es único sólo entre productos no eliminados', async () => {
    await asOwner(() => trash('products', id(2)));
    // Con el viejo en la Papelera, el código queda libre para uno nuevo.
    await asOwner(() =>
      db.query(
        `insert into public.products(id,business_id,name,barcode,sale_price_cents)
         values($1,$2,'Reposición','777',1600)`,
        [id(20), IDS.business],
      ),
    );
    // Dos vivos con el mismo código siguen prohibidos.
    await expect(
      asOwner(() =>
        db.query(
          `insert into public.products(id,business_id,name,barcode,sale_price_cents)
           values($1,$2,'Duplicado','777',1)`,
          [id(21), IDS.business],
        ),
      ),
    ).rejects.toMatchObject({ code: '23505' });
    // Restaurar el viejo mientras el nuevo está vivo falla por la misma restricción…
    await expect(
      asOwner(() => restore('products', id(2))),
    ).rejects.toMatchObject({
      code: '23505',
    });
    // …y funciona cuando el nuevo se elimina.
    await asOwner(() => trash('products', id(20)));
    await asOwner(() => restore('products', id(2)));
    expect((await row('products', id(2))).deleted_at).toBeNull();
  });

  it('las ventas históricas siguen resolviendo el producto eliminado', async () => {
    await db.query(
      `insert into public.sales(id,business_id,branch_id,created_by,status,subtotal_cents,total_cents,payment_method)
       values($1,$2,$3,$4,'completed',1500,1500,'cash')`,
      [id(30), IDS.business, IDS.branch, IDS.owner],
    );
    await db.query(
      `insert into public.sale_items(id,business_id,sale_id,product_id,product_name,barcode,unit_price_cents,quantity,total_cents)
       values($1,$2,$3,$4,'Producto prueba 123','777',1500,1,1500)`,
      [id(31), IDS.business, id(30), id(2)],
    );
    await asOwner(() => trash('products', id(2)));
    const history = await asStaff(() =>
      db.query<{
        product_name: string;
        name: string;
        deleted_at: string | null;
      }>(
        `select i.product_name, p.name, p.deleted_at from public.sale_items i
         join public.products p on p.id=i.product_id where i.id=$1`,
        [id(31)],
      ),
    );
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]).toMatchObject({
      product_name: 'Producto prueba 123',
      name: 'Producto prueba 123',
    });
    expect(history.rows[0]!.deleted_at).not.toBeNull();
    await asOwner(() => restore('products', id(2)));
  });

  it('una categoría eliminada conserva el vínculo de sus productos y reserva su nombre', async () => {
    await asOwner(() => trash('product_categories', id(1)));
    const product = await db.query<{ category_id: string }>(
      `select category_id from public.products where id=$1`,
      [id(2)],
    );
    expect(product.rows[0]!.category_id).toBe(id(1));
    await expect(
      asOwner(() =>
        db.query(
          `insert into public.product_categories(id,business_id,name) values($1,$2,'Marcos')`,
          [id(40), IDS.business],
        ),
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await asOwner(() => restore('product_categories', id(1)));
  });

  it('respeta los permisos de cada catálogo', async () => {
    // Productos y categorías: cualquier miembro.
    await asStaff(() => trash('products', id(2)));
    expect((await row('products', id(2))).deleted_at).not.toBeNull();
    await asStaff(() => restore('products', id(2)));
    // Recursos, tipos y marquetería: sólo owner/admin (el staff no modifica ninguna fila).
    for (const [table, n] of [
      ['resources', 5],
      ['appointment_types', 3],
      ['event_types', 4],
      ['frame_mouldings', 6],
      ['frame_materials', 7],
    ] as const) {
      await asStaff(() => trash(table, id(n)));
      expect((await row(table, id(n))).deleted_at).toBeNull();
    }
  });

  it('owner/admin eliminan y restauran el resto de los catálogos', async () => {
    for (const [table, n] of [
      ['resources', 5],
      ['appointment_types', 3],
      ['event_types', 4],
      ['frame_mouldings', 6],
      ['frame_materials', 7],
    ] as const) {
      await asOwner(() => trash(table, id(n)));
      const deleted = await row(table, id(n));
      expect(deleted.deleted_at).not.toBeNull();
      expect(deleted.is_active).toBe(true);
      await asOwner(() => restore(table, id(n)));
      expect((await row(table, id(n))).deleted_at).toBeNull();
    }
  });

  it('otro negocio no puede eliminar ni restaurar', async () => {
    const result = await asOutsider(() =>
      db.query(`update public.products set deleted_at=now() where id=$1`, [
        id(2),
      ]),
    );
    expect(result.affectedRows ?? 0).toBe(0);
    expect((await row('products', id(2))).deleted_at).toBeNull();
  });
});
