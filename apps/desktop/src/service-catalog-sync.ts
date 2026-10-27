import Database from '@tauri-apps/plugin-sql';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './cloud-config';

type Row = Record<string, unknown>;
const specs = {
  price_list: {
    table: 'price_lists',
    fields: ['name', 'kind', 'is_default', 'is_active'],
    booleans: ['is_default', 'is_active'],
    json: [],
  },
  lab_variant: {
    table: 'lab_variants',
    fields: ['photo_service_id', 'channel', 'paper', 'is_active'],
    booleans: ['is_active'],
    json: [],
  },
  lab_price_tier: {
    table: 'lab_price_tiers',
    fields: [
      'variant_id',
      'price_list_id',
      'min_quantity',
      'max_quantity',
      'unit_price_cents',
    ],
    booleans: [],
    json: [],
  },
  plotter_material: {
    table: 'plotter_materials',
    fields: ['code', 'name', 'roll_width_mm', 'is_active'],
    booleans: ['is_active'],
    json: [],
  },
  plotter_rate: {
    table: 'plotter_rates',
    fields: ['price_list_id', 'code', 'amount_cents', 'width_mm', 'height_mm'],
    booleans: [],
    json: [],
  },
  plotter_quote: {
    table: 'plotter_quotes',
    fields: [
      'branch_id',
      'customer_id',
      'price_list_id',
      'status',
      'snapshot',
      'total_cents',
      'notes',
      'created_by',
    ],
    booleans: [],
    json: ['snapshot'],
  },
  event_offer: {
    table: 'event_offers',
    fields: [
      'kind',
      'name',
      'width_mm',
      'height_mm',
      'projection',
      'with_projector',
      'primary_resource_id',
      'projector_resource_id',
      'is_active',
    ],
    booleans: ['with_projector', 'is_active'],
    json: [],
  },
  event_offer_rate: {
    table: 'event_offer_rates',
    fields: ['offer_id', 'price_list_id', 'amount_cents'],
    booleans: [],
    json: [],
  },
  led_panel_pool: {
    table: 'led_panel_pools',
    fields: ['total_panels', 'panel_area_mm2', 'pixels_per_panel', 'is_active'],
    booleans: ['is_active'],
    json: [],
  },
  led_preset: {
    table: 'led_presets',
    fields: ['name', 'width_mm', 'height_mm', 'is_active'],
    booleans: ['is_active'],
    json: [],
  },
  led_controller: {
    table: 'led_controllers',
    fields: ['resource_id', 'max_pixels'],
    booleans: [],
    json: [],
  },
  led_panel_reservation: {
    table: 'led_panel_reservations',
    fields: [
      'event_id',
      'event_service_item_id',
      'controller_resource_id',
      'starts_at',
      'ends_at',
      'panels',
      'is_active',
    ],
    booleans: ['is_active'],
    json: [],
  },
} as const;
export type ServiceCatalogSyncType = keyof typeof specs;
type Pending = Row & {
  outbox_id: string;
  outbox_revision: number;
  cloud_updated_at: string | null;
};
export interface CatalogSyncIssue {
  id: string;
  source: string;
  entityType: string;
  entityId: string;
  status: 'pending' | 'conflict';
  lastError: string | null;
}
export async function catalogSyncIssues(
  businessId: string,
): Promise<CatalogSyncIssue[]> {
  const db = await Database.load('sqlite:centrocolor.db');
  const rows = await db.select<
    Array<{
      id: string;
      source: string;
      entity_type: string;
      entity_id: string;
      status: 'pending' | 'conflict';
      last_error: string | null;
    }>
  >(
    `SELECT id,'Servicios y precios' source,entity_type,entity_id,status,last_error FROM service_catalog_outbox WHERE business_id=?
     UNION ALL SELECT id,'Servicios/LED' source,entity_type,entity_id,status,last_error FROM event_service_outbox WHERE business_id=?`,
    [businessId, businessId],
  );
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    entityType: r.entity_type,
    entityId: r.entity_id,
    status: r.status,
    lastError: r.last_error,
  }));
}

const specFor = (type: ServiceCatalogSyncType) => specs[type];
const fieldsFor = (type: ServiceCatalogSyncType, row: Row): Row => {
  const spec = specFor(type);
  const result: Row = {};
  for (const column of spec.fields) {
    const value = row[column];
    result[column] = (spec.booleans as readonly string[]).includes(column)
      ? Boolean(value === true || value === 1)
      : (spec.json as readonly string[]).includes(column) &&
          typeof value === 'string'
        ? (JSON.parse(value) as unknown)
        : value;
  }
  return result;
};
const sameFields = (type: ServiceCatalogSyncType, a: Row, b: Row) =>
  JSON.stringify(fieldsFor(type, a)) === JSON.stringify(fieldsFor(type, b));

/** Pull/push one entity in the same order as its FK dependencies. */
export async function syncServiceCatalog(
  type: ServiceCatalogSyncType,
  businessId: string,
  client: SupabaseClient = getSupabaseClient(),
) {
  const spec = specFor(type);
  const eventService = type.startsWith('event_') || type.startsWith('led_');
  const outbox = eventService
    ? 'event_service_outbox'
    : 'service_catalog_outbox';
  const cursorTable = eventService
    ? 'event_service_cursor'
    : 'service_catalog_cursor';
  const db = await Database.load('sqlite:centrocolor.db');
  const pending = await db.select<Pending[]>(
    `SELECT o.id outbox_id,o.local_revision outbox_revision,t.* FROM ${outbox} o
     JOIN ${spec.table} t ON t.business_id=o.business_id AND t.id=o.entity_id
     WHERE o.business_id=? AND o.entity_type=? AND o.status='pending'
     ORDER BY o.created_at,o.id LIMIT 100`,
    [businessId, type],
  );
  for (const row of pending) {
    const payload = fieldsFor(type, row);
    let remote: Row | null = null;
    let pushError: string | null = null;
    let pushConflict = false;
    if (row.cloud_updated_at == null) {
      const { data, error } = await client
        .from(spec.table)
        .insert({
          id: row.id,
          business_id: businessId,
          ...payload,
          created_at: row.created_at,
        })
        .select('*')
        .single();
      if (!error) remote = data as Row;
      else if (error.code !== '23505') {
        pushError = error.message;
        pushConflict = error.code === '23P01' || error.message.includes('LED_');
      }
    } else {
      // Quotes freeze every monetary field: only a status transition is mutable.
      const change =
        type === 'plotter_quote' ? { status: payload.status } : payload;
      const { data, error } = await client
        .from(spec.table)
        .update(change)
        .eq('business_id', businessId)
        .eq('id', String(row.id))
        .eq('updated_at', row.cloud_updated_at)
        .select('*')
        .maybeSingle();
      if (error) {
        pushError = error.message;
        pushConflict = error.code === '23P01' || error.message.includes('LED_');
      } else if (data) remote = data as Row;
    }
    if (!remote && !pushError) {
      const { data, error } = await client
        .from(spec.table)
        .select('*')
        .eq('business_id', businessId)
        .eq('id', String(row.id))
        .maybeSingle();
      if (error) pushError = error.message;
      else if (data && sameFields(type, row, data as Row)) remote = data as Row;
      else if (data) {
        await db.execute(
          `UPDATE ${outbox} SET status='conflict',last_error=?,remote_updated_at=?,remote_snapshot=?
          WHERE id=? AND business_id=? AND local_revision=?`,
          [
            'El registro también cambió en Cloud.',
            String((data as Row).updated_at),
            JSON.stringify(data),
            row.outbox_id,
            businessId,
            row.outbox_revision,
          ],
        );
        continue;
      } else pushError = 'El registro Cloud no está disponible.';
    }
    if (pushError) {
      await db.execute(
        `UPDATE ${outbox} SET attempts=attempts+1,last_error=?,status=? WHERE id=? AND business_id=?`,
        [
          pushError.slice(0, 500),
          pushConflict ? 'conflict' : 'pending',
          row.outbox_id,
          businessId,
        ],
      );
      continue;
    }
    await db.execute(
      `UPDATE ${spec.table} SET cloud_updated_at=? WHERE business_id=? AND id=?`,
      [String(remote!.updated_at), businessId, row.id],
    );
    await db.execute(
      `DELETE FROM ${outbox} WHERE id=? AND business_id=? AND local_revision=? AND status='pending'`,
      [row.outbox_id, businessId, row.outbox_revision],
    );
  }

  const cursor = await db.select<{ updated_at: string; entity_id: string }[]>(
    `SELECT updated_at,entity_id FROM ${cursorTable} WHERE business_id=? AND entity_type=?`,
    [businessId, type],
  );
  let after = cursor[0] ?? null;
  for (;;) {
    let query = client
      .from(spec.table)
      .select('*')
      .eq('business_id', businessId);
    if (after)
      query = query.or(
        `updated_at.gt.${after.updated_at},and(updated_at.eq.${after.updated_at},id.gt.${after.entity_id})`,
      );
    const { data, error } = await query
      .order('updated_at')
      .order('id')
      .limit(100);
    if (error) throw error;
    const page = (data ?? []) as Row[];
    for (const remote of page) {
      const id = String(remote.id);
      const hasPending = await db.select<{ id: string }[]>(
        `SELECT id FROM ${outbox} WHERE business_id=? AND entity_type=? AND entity_id=? LIMIT 1`,
        [businessId, type, id],
      );
      if (!hasPending.length) {
        const columns = [
          'id',
          'business_id',
          ...spec.fields,
          'created_at',
          'updated_at',
          'sync_origin',
          'local_revision',
          'cloud_updated_at',
        ];
        const values = [
          id,
          businessId,
          ...spec.fields.map((key) => {
            const value = remote[key];
            return (spec.booleans as readonly string[]).includes(key)
              ? value
                ? 1
                : 0
              : (spec.json as readonly string[]).includes(key)
                ? JSON.stringify(value)
                : value;
          }),
          remote.created_at,
          remote.updated_at,
          'remote',
          0,
          remote.updated_at,
        ];
        const assignments = [
          ...spec.fields,
          'created_at',
          'updated_at',
          'sync_origin',
          'cloud_updated_at',
        ]
          .map((key) => `${key}=excluded.${key}`)
          .join(',');
        await db.execute(
          `INSERT INTO ${spec.table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})
          ON CONFLICT(id) DO UPDATE SET ${assignments} WHERE ${spec.table}.business_id=excluded.business_id`,
          values,
        );
      }
      after = { updated_at: String(remote.updated_at), entity_id: id };
      await db.execute(
        `INSERT INTO ${cursorTable}(business_id,entity_type,updated_at,entity_id)
        VALUES(?,?,?,?) ON CONFLICT(business_id,entity_type) DO UPDATE SET
        updated_at=excluded.updated_at,entity_id=excluded.entity_id`,
        [businessId, type, after.updated_at, after.entity_id],
      );
    }
    if (page.length < 100) break;
  }
}
