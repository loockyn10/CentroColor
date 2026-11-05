import Database from '@tauri-apps/plugin-sql';
import type { TrashRepository } from '@centrocolor/application';
import {
  canManageTrash,
  type TrashEntityType,
  type TrashItem,
} from '@centrocolor/domain';

const database = () => Database.load('sqlite:centrocolor.db');

interface Spec {
  table: string;
  /** Expresión SQL con un dato breve para reconocer el elemento. */
  detail: string;
}

export const trashSpecs: Record<TrashEntityType, Spec> = {
  product: { table: 'products', detail: 'barcode' },
  product_category: { table: 'product_categories', detail: 'NULL' },
  appointment_type: {
    table: 'appointment_types',
    detail: "default_duration_minutes || ' min'",
  },
  event_type: { table: 'event_types', detail: 'NULL' },
  resource: { table: 'resources', detail: 'description' },
  frame_moulding: { table: 'frame_mouldings', detail: 'code' },
  frame_material: {
    table: 'frame_materials',
    detail: `CASE material_type WHEN 'glass' THEN 'Vidrio' WHEN 'backing' THEN 'Respaldo'
      WHEN 'passepartout' THEN 'Passepartout' WHEN 'print' THEN 'Impresión' ELSE 'Otro' END`,
  },
};

const notFound = 'No se encontró el elemento.';

/** Mismos permisos que Cloud: productos y categorías, cualquier miembro; el resto, owner/admin. */
async function assertAllowed(businessId: string, type: TrashEntityType) {
  const db = await database();
  const rows = await db.select<{ role: string }[]>(
    'SELECT role FROM authorized_context WHERE slot=1 AND business_id=?',
    [businessId],
  );
  const role = rows[0]?.role;
  if (!role || !canManageTrash(role, type))
    throw new Error('Solo owner/admin puede gestionar este tipo de elemento.');
}

function restoreMessage(type: TrashEntityType) {
  return type === 'product'
    ? 'No se puede restaurar: otro producto ya usa ese código de barras.'
    : type === 'product_category'
      ? 'No se puede restaurar: ya existe otra categoría con ese nombre.'
      : 'No se puede restaurar: ya existe un elemento igual.';
}

/**
 * Papelera sobre SQLite. Eliminar y restaurar son un UPDATE de `deleted_at` con
 * `sync_origin='local'` y `local_revision+1`: los triggers de cada catálogo (0020) lo encolan en su
 * outbox y el sync lo sube a Cloud igual que cualquier edición.
 */
export class SQLiteTrashRepository implements TrashRepository {
  async list(businessId: string): Promise<TrashItem[]> {
    const db = await database();
    const results = await Promise.all(
      (Object.entries(trashSpecs) as [TrashEntityType, Spec][]).map(
        async ([type, spec]) => {
          const rows = await db.select<
            {
              id: string;
              name: string;
              detail: string | null;
              deleted_at: string;
            }[]
          >(
            `SELECT id, name, ${spec.detail} AS detail, deleted_at FROM ${spec.table}
             WHERE business_id = ? AND deleted_at IS NOT NULL`,
            [businessId],
          );
          return rows.map((row): TrashItem => ({
            type,
            id: row.id,
            name: row.name,
            detail: row.detail || null,
            deletedAt: row.deleted_at,
          }));
        },
      ),
    );
    return results.flat();
  }

  private async setDeleted(
    businessId: string,
    type: TrashEntityType,
    id: string,
    deletedAt: string | null,
  ) {
    await assertAllowed(businessId, type);
    const db = await database();
    const result = await db.execute(
      `UPDATE ${trashSpecs[type].table} SET deleted_at = ?, updated_at = ?,
         sync_origin = 'local', local_revision = local_revision + 1
       WHERE business_id = ? AND id = ?
         AND deleted_at IS ${deletedAt === null ? 'NOT NULL' : 'NULL'}`,
      [deletedAt, new Date().toISOString(), businessId, id],
    );
    if (!result.rowsAffected) throw new Error(notFound);
  }

  async trash(businessId: string, type: TrashEntityType, id: string) {
    await this.setDeleted(businessId, type, id, new Date().toISOString());
  }

  async restore(businessId: string, type: TrashEntityType, id: string) {
    try {
      await this.setDeleted(businessId, type, id, null);
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed'))
        throw new Error(restoreMessage(type));
      throw error;
    }
  }
}
