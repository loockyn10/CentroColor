import {
  isTrashEntityType,
  sortTrash,
  trashTypeLabels,
  type TrashEntityType,
  type TrashItem,
} from '@centrocolor/domain';

/**
 * Puerto de la Papelera de catálogos (ver `domain/trash.ts`). Una implementación por app: Web
 * (Supabase) y Desktop (SQLite, con outbox de sync). Nunca borra filas: sólo marca/limpia
 * `deleted_at`, así que el historial conserva sus referencias.
 */
export interface TrashRepository {
  /** Elementos eliminados de todos los catálogos, sin ordenar. */
  list(businessId: string): Promise<TrashItem[]>;
  /** Envía a la Papelera. No altera `is_active`. */
  trash(businessId: string, type: TrashEntityType, id: string): Promise<void>;
  /** Saca de la Papelera: el elemento vuelve con el estado Activo/Inactivo que tenía. */
  restore(businessId: string, type: TrashEntityType, id: string): Promise<void>;
}

function requireType(type: string): TrashEntityType {
  if (!isTrashEntityType(type))
    throw new Error('Ese tipo de elemento no usa la Papelera.');
  return type;
}

export async function listTrash(
  repository: TrashRepository,
  businessId: string,
): Promise<TrashItem[]> {
  return sortTrash(await repository.list(businessId));
}

export async function trashItem(
  repository: TrashRepository,
  businessId: string,
  type: TrashEntityType,
  id: string,
): Promise<void> {
  await repository.trash(businessId, requireType(type), id);
}

export async function restoreItem(
  repository: TrashRepository,
  businessId: string,
  type: TrashEntityType,
  id: string,
): Promise<void> {
  await repository.restore(businessId, requireType(type), id);
}

/** Texto de la fila de Papelera: «Producto · 7791234» (tipo y dato breve). */
export function describeTrashItem(item: TrashItem): string {
  return [trashTypeLabels[item.type], item.detail].filter(Boolean).join(' · ');
}
