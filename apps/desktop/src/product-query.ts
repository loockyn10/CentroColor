import type { ProductListFilter } from '@centrocolor/application';

/**
 * Consulta del listado de Productos en SQLite. Pura (sin acceso a la base) para probarla:
 *  - los productos de la Papelera (`deleted_at`) nunca se incluyen;
 *  - «Inactivo» filtra `is_active = 0` y no tiene nada que ver con la Papelera;
 *  - búsqueda, categoría y estado se combinan con AND.
 */
export function productListQuery(
  businessId: string,
  query: string,
  limit: number,
  filter: ProductListFilter = {},
): { sql: string; args: (string | number)[] } {
  const term = `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`;
  const where = [
    'business_id = ?',
    'deleted_at IS NULL',
    "(name LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\')",
  ];
  const args: (string | number)[] = [businessId, term, term];
  if (filter.categoryId) {
    where.push('category_id = ?');
    args.push(filter.categoryId);
  }
  if (filter.uncategorized) where.push('category_id IS NULL');
  if (filter.status) {
    where.push('is_active = ?');
    args.push(filter.status === 'active' ? 1 : 0);
  }
  return {
    sql: `SELECT * FROM products WHERE ${where.join(' AND ')}
       ORDER BY is_active DESC, name COLLATE NOCASE, id LIMIT ?`,
    args: [...args, limit],
  };
}
