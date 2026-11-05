/**
 * Papelera de catálogos. «Eliminar» es una baja reversible distinta de «Inactivo»:
 *  - inactivo  → el elemento existe y sigue en sus listados, pero no se ofrece;
 *  - eliminado → desaparece de listados, búsquedas, filtros y selectores y sólo se ve (y se
 *    restaura) en Configuración → Papelera. La fila nunca se borra, de modo que el historial
 *    (ventas, turnos, reservas, cotizaciones) conserva sus referencias.
 *
 * Sólo catálogos de configuración. Ventas, pagos, movimientos de stock, reservas, cotizaciones y
 * cualquier registro de auditoría NO usan este patrón.
 */

export const trashEntityTypes = [
  'product',
  'product_category',
  'appointment_type',
  'event_type',
  'resource',
  'frame_moulding',
  'frame_material',
] as const;
export type TrashEntityType = (typeof trashEntityTypes)[number];

/** Nombre del tipo tal como lo lee el usuario en la Papelera. */
export const trashTypeLabels: Record<TrashEntityType, string> = {
  product: 'Producto',
  product_category: 'Categoría de productos',
  appointment_type: 'Tipo de turno',
  event_type: 'Tipo de presupuesto o reserva',
  resource: 'Recurso',
  frame_moulding: 'Varilla de marquetería',
  frame_material: 'Material de marquetería',
};

export interface TrashItem {
  type: TrashEntityType;
  id: string;
  name: string;
  /** Dato breve que ayuda a reconocerlo (código de barras, duración…). */
  detail: string | null;
  deletedAt: string;
}

export function isTrashEntityType(value: string): value is TrashEntityType {
  return (trashEntityTypes as readonly string[]).includes(value);
}

/** ¿Está en la Papelera? Distinto de `!isActive`. */
export function isDeleted(entity: { deletedAt?: string | null }): boolean {
  return Boolean(entity.deletedAt);
}

/** Elimina de una lista lo que está en la Papelera (defensa en profundidad de los listados). */
export function withoutDeleted<T extends { deletedAt?: string | null }>(
  items: readonly T[],
): T[] {
  return items.filter((item) => !isDeleted(item));
}

/**
 * Quién puede eliminar y restaurar. Replica los permisos que ya tiene cada catálogo (RLS en Cloud,
 * `assertAdmin` en Desktop): productos y categorías, cualquier miembro; el resto, owner/admin.
 */
export function canManageTrash(role: string, type: TrashEntityType): boolean {
  if (role === 'owner' || role === 'admin') return true;
  return type === 'product' || type === 'product_category';
}

/** Lo más recientemente eliminado primero; desempata por tipo y nombre. */
export function sortTrash(items: readonly TrashItem[]): TrashItem[] {
  return [...items].sort(
    (a, b) =>
      b.deletedAt.localeCompare(a.deletedAt) ||
      a.type.localeCompare(b.type) ||
      a.name.localeCompare(b.name, 'es'),
  );
}
