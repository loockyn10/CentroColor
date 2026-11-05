import type { SupabaseClient } from '@supabase/supabase-js';
import type { TrashRepository } from '@centrocolor/application';
import type { TrashEntityType, TrashItem } from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';

interface Spec {
  table: string;
  /** Columna extra para reconocer el elemento (código de barras, duración…). */
  detail?: string;
  format?: (value: unknown) => string | null;
}

const materialTypes: Record<string, string> = {
  glass: 'Vidrio',
  backing: 'Respaldo',
  passepartout: 'Passepartout',
  print: 'Impresión',
  other: 'Otro',
};

const specs: Record<TrashEntityType, Spec> = {
  product: { table: 'products', detail: 'barcode' },
  product_category: { table: 'product_categories' },
  appointment_type: {
    table: 'appointment_types',
    detail: 'default_duration_minutes',
    format: (value) => (value ? `${value} min` : null),
  },
  event_type: { table: 'event_types' },
  resource: { table: 'resources', detail: 'description' },
  frame_moulding: { table: 'frame_mouldings', detail: 'code' },
  frame_material: {
    table: 'frame_materials',
    detail: 'material_type',
    format: (value) => materialTypes[String(value)] ?? null,
  },
};

const notFound = 'No se encontró el elemento.';

function restoreError(type: TrashEntityType, error: { code?: string }): never {
  if (error.code === '23505') {
    throw new Error(
      type === 'product'
        ? 'No se puede restaurar: otro producto ya usa ese código de barras.'
        : type === 'product_category'
          ? 'No se puede restaurar: ya existe otra categoría con ese nombre.'
          : 'No se puede restaurar: ya existe un elemento igual.',
    );
  }
  throw error;
}

/**
 * Papelera sobre Supabase. Eliminar y restaurar sólo escriben `deleted_at`; el RLS de cada
 * tabla decide quién puede (productos y categorías: cualquier miembro; el resto: owner/admin).
 */
export class SupabaseTrashRepository implements TrashRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(businessId: string): Promise<TrashItem[]> {
    const results = await Promise.all(
      (Object.entries(specs) as [TrashEntityType, Spec][]).map(
        async ([type, spec]) => {
          const columns = ['id', 'name', 'deleted_at', spec.detail]
            .filter(Boolean)
            .join(',');
          const { data, error } = await this.client
            .from(spec.table)
            .select(columns)
            .eq('business_id', businessId)
            .not('deleted_at', 'is', null);
          if (error) throw error;
          return ((data ?? []) as unknown as Record<string, unknown>[]).map(
            (row): TrashItem => {
              const raw = spec.detail ? row[spec.detail] : null;
              const detail = spec.format
                ? spec.format(raw)
                : raw
                  ? String(raw)
                  : null;
              return {
                type,
                id: String(row.id),
                name: String(row.name),
                detail,
                deletedAt: String(row.deleted_at),
              };
            },
          );
        },
      ),
    );
    return results.flat();
  }

  async trash(businessId: string, type: TrashEntityType, id: string) {
    const { data, error } = await this.client
      .from(specs[type].table)
      .update({ deleted_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .eq('id', id)
      .is('deleted_at', null)
      .select('id');
    if (error) throw error;
    if (!data?.length) throw new Error(notFound);
  }

  async restore(businessId: string, type: TrashEntityType, id: string) {
    const { data, error } = await this.client
      .from(specs[type].table)
      .update({ deleted_at: null })
      .eq('business_id', businessId)
      .eq('id', id)
      .not('deleted_at', 'is', null)
      .select('id');
    if (error) restoreError(type, error);
    if (!data?.length) throw new Error(notFound);
  }
}
