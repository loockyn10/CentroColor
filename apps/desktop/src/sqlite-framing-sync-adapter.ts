/* eslint-disable @typescript-eslint/no-explicit-any -- isolated SQLite sync mapping. */
import Database from '@tauri-apps/plugin-sql';
import type {
  FramingCursor,
  FramingSyncEntity,
  FramingSyncLocalPort,
  FramingSyncType,
  PendingFramingChange,
} from '@centrocolor/application';
const db = () => Database.load('sqlite:centrocolor.db');
const table = (t: FramingSyncType) =>
  ({
    moulding: 'frame_mouldings',
    material: 'frame_materials',
    settings: 'framing_settings',
    quote: 'frame_quotes',
    quote_item: 'frame_quote_items',
    job: 'frame_jobs',
  })[t];
const decode = (t: FramingSyncType, r: any): any => {
  const base = {
    id: r.id ?? r.business_id,
    businessId: r.business_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (t === 'moulding')
    return {
      ...base,
      code: r.code,
      name: r.name,
      description: r.description,
      faceWidthMm: r.face_width_mm,
      costPerMeterCents: r.cost_per_meter_cents,
      salePricePerMeterCents: r.sale_price_per_meter_cents,
      wastePercent: r.waste_percent,
      isActive: r.is_active === 1,
    };
  if (t === 'material')
    return {
      ...base,
      name: r.name,
      materialType: r.material_type,
      pricingUnit: r.pricing_unit,
      costCents: r.cost_cents,
      salePriceCents: r.sale_price_cents,
      wastePercent: r.waste_percent,
      isActive: r.is_active === 1,
    };
  if (t === 'settings')
    return {
      businessId: r.business_id,
      defaultMarkupPercent: r.default_markup_percent,
      defaultLabourCents: r.default_labour_cents,
      defaultMouldingWastePercent: r.default_moulding_waste_percent,
      defaultMaterialWastePercent: r.default_material_waste_percent,
      updatedAt: r.updated_at,
    };
  if (t === 'quote')
    return {
      ...base,
      branchId: r.branch_id,
      customerId: r.customer_id,
      widthMm: r.width_mm,
      heightMm: r.height_mm,
      measurementMode: r.measurement_mode,
      status: r.status,
      notes: r.notes,
      subtotalCents: r.subtotal_cents,
      totalCents: r.total_cents,
      createdBy: r.created_by,
    };
  if (t === 'quote_item')
    return {
      ...base,
      quoteId: r.quote_id,
      itemType: r.item_type,
      sourceId: r.source_id,
      nameSnapshot: r.name_snapshot,
      quantityNumerator: r.quantity_numerator,
      quantityDenominator: r.quantity_denominator,
      unit: r.unit,
      unitPriceCents: r.unit_price_cents,
      totalCents: r.total_cents,
      metadata: JSON.parse(r.metadata_json),
    };
  return {
    ...base,
    branchId: r.branch_id,
    quoteId: r.quote_id,
    customerId: r.customer_id,
    status: r.status,
    promisedAt: r.promised_at,
    notes: r.notes,
  };
};
export class SQLiteFramingSyncAdapter implements FramingSyncLocalPort {
  async pending(t: FramingSyncType, b: string, limit: number) {
    const rows = await (
      await db()
    ).select<any[]>(
      `SELECT x.*,o.id outbox_id,o.local_revision outbox_revision FROM framing_sync_outbox o JOIN ${table(t)} x ON x.business_id=o.business_id AND ${t === 'settings' ? 'x.business_id' : 'x.id'}=o.entity_id WHERE o.business_id=? AND o.entity_type=? AND o.status='pending' ORDER BY o.created_at LIMIT ?`,
      [b, t, limit],
    );
    return rows.map(
      (r) =>
        ({
          outboxId: r.outbox_id,
          entityType: t,
          entity: decode(t, r),
          localRevision: r.outbox_revision,
          cloudUpdatedAt: r.cloud_updated_at,
        }) satisfies PendingFramingChange,
    );
  }
  async pendingFor(t: FramingSyncType, b: string, id: string) {
    return (
      (await this.pending(t, b, 100)).find(
        (x) => (x.entity as any).id === id || (t === 'settings' && b === id),
      ) ?? null
    );
  }
  async acknowledge(c: PendingFramingChange, cloud: FramingSyncEntity) {
    const d = await db();
    await d.execute(
      `UPDATE ${table(c.entityType)} SET cloud_updated_at=? WHERE business_id=? AND ${c.entityType === 'settings' ? 'business_id' : 'id'}=?`,
      [
        cloud.updatedAt,
        c.entity.businessId,
        (cloud as any).id ?? cloud.businessId,
      ],
    );
    await d.execute(
      `DELETE FROM framing_sync_outbox WHERE id=? AND local_revision=?`,
      [c.outboxId, c.localRevision],
    );
  }
  async fail(c: PendingFramingChange, message: string) {
    await (
      await db()
    ).execute(
      `UPDATE framing_sync_outbox SET attempts=attempts+1,last_error=? WHERE id=?`,
      [message.slice(0, 500), c.outboxId],
    );
  }
  async conflict(c: PendingFramingChange, cloud: FramingSyncEntity) {
    await (
      await db()
    ).execute(
      `UPDATE framing_sync_outbox SET status='conflict',remote_updated_at=?,remote_snapshot=?,last_error=? WHERE id=?`,
      [
        cloud.updatedAt,
        JSON.stringify(cloud),
        'El registro cambió también en Cloud.',
        c.outboxId,
      ],
    );
  }
  async applyRemote(t: FramingSyncType, e: FramingSyncEntity) {
    const d = await db();
    const x: any = e;
    if (t === 'settings') {
      await d.execute(
        `INSERT INTO framing_settings(business_id,default_markup_percent,default_labour_cents,default_moulding_waste_percent,default_material_waste_percent,updated_at,sync_origin,cloud_updated_at) VALUES(?,?,?,?,?,?, 'remote',?) ON CONFLICT(business_id) DO UPDATE SET default_markup_percent=excluded.default_markup_percent,default_labour_cents=excluded.default_labour_cents,default_moulding_waste_percent=excluded.default_moulding_waste_percent,default_material_waste_percent=excluded.default_material_waste_percent,updated_at=excluded.updated_at,sync_origin='remote',cloud_updated_at=excluded.cloud_updated_at`,
        [
          x.businessId,
          x.defaultMarkupPercent,
          x.defaultLabourCents,
          x.defaultMouldingWastePercent,
          x.defaultMaterialWastePercent,
          x.updatedAt,
          x.updatedAt,
        ],
      );
      return true;
    }
    const existing = await this.pendingFor(t, x.businessId, x.id);
    if (existing) return false;
    const cols =
      t === 'moulding'
        ? [
            'id',
            'business_id',
            'code',
            'name',
            'description',
            'face_width_mm',
            'cost_per_meter_cents',
            'sale_price_per_meter_cents',
            'waste_percent',
            'is_active',
            'created_at',
            'updated_at',
            'sync_origin',
            'cloud_updated_at',
          ]
        : t === 'material'
          ? [
              'id',
              'business_id',
              'name',
              'material_type',
              'pricing_unit',
              'cost_cents',
              'sale_price_cents',
              'waste_percent',
              'is_active',
              'created_at',
              'updated_at',
              'sync_origin',
              'cloud_updated_at',
            ]
          : t === 'quote'
            ? [
                'id',
                'business_id',
                'branch_id',
                'customer_id',
                'width_mm',
                'height_mm',
                'measurement_mode',
                'status',
                'notes',
                'subtotal_cents',
                'total_cents',
                'created_by',
                'created_at',
                'updated_at',
                'sync_origin',
                'cloud_updated_at',
              ]
            : t === 'quote_item'
              ? [
                  'id',
                  'business_id',
                  'quote_id',
                  'item_type',
                  'source_id',
                  'name_snapshot',
                  'quantity_numerator',
                  'quantity_denominator',
                  'unit',
                  'unit_price_cents',
                  'total_cents',
                  'metadata_json',
                  'created_at',
                  'updated_at',
                  'sync_origin',
                  'cloud_updated_at',
                ]
              : [
                  'id',
                  'business_id',
                  'branch_id',
                  'quote_id',
                  'customer_id',
                  'status',
                  'promised_at',
                  'notes',
                  'created_at',
                  'updated_at',
                  'sync_origin',
                  'cloud_updated_at',
                ];
    const values =
      t === 'moulding'
        ? [
            x.id,
            x.businessId,
            x.code,
            x.name,
            x.description,
            x.faceWidthMm,
            x.costPerMeterCents,
            x.salePricePerMeterCents,
            x.wastePercent,
            x.isActive ? 1 : 0,
            x.createdAt,
            x.updatedAt,
            'remote',
            x.updatedAt,
          ]
        : t === 'material'
          ? [
              x.id,
              x.businessId,
              x.name,
              x.materialType,
              x.pricingUnit,
              x.costCents,
              x.salePriceCents,
              x.wastePercent,
              x.isActive ? 1 : 0,
              x.createdAt,
              x.updatedAt,
              'remote',
              x.updatedAt,
            ]
          : t === 'quote'
            ? [
                x.id,
                x.businessId,
                x.branchId,
                x.customerId,
                x.widthMm,
                x.heightMm,
                x.measurementMode,
                x.status,
                x.notes,
                x.subtotalCents,
                x.totalCents,
                x.createdBy,
                x.createdAt,
                x.updatedAt,
                'remote',
                x.updatedAt,
              ]
            : t === 'quote_item'
              ? [
                  x.id,
                  x.businessId,
                  x.quoteId,
                  x.itemType,
                  x.sourceId,
                  x.nameSnapshot,
                  x.quantityNumerator,
                  x.quantityDenominator,
                  x.unit,
                  x.unitPriceCents,
                  x.totalCents,
                  JSON.stringify(x.metadata),
                  x.createdAt,
                  x.updatedAt,
                  'remote',
                  x.updatedAt,
                ]
              : [
                  x.id,
                  x.businessId,
                  x.branchId,
                  x.quoteId,
                  x.customerId,
                  x.status,
                  x.promisedAt,
                  x.notes,
                  x.createdAt,
                  x.updatedAt,
                  'remote',
                  x.updatedAt,
                ];
    await d.execute(
      `INSERT OR REPLACE INTO ${table(t)}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`,
      values,
    );
    return true;
  }
  async cursor(t: FramingSyncType, b: string) {
    const r = await (
      await db()
    ).select<any[]>(
      `SELECT updated_at,entity_id FROM framing_sync_cursor WHERE business_id=? AND entity_type=?`,
      [b, t],
    );
    return r[0] ? { updatedAt: r[0].updated_at, id: r[0].entity_id } : null;
  }
  async advanceCursor(t: FramingSyncType, b: string, c: FramingCursor) {
    await (
      await db()
    ).execute(
      `INSERT INTO framing_sync_cursor VALUES(?,?,?,?,?) ON CONFLICT(business_id,entity_type) DO UPDATE SET updated_at=excluded.updated_at,entity_id=excluded.entity_id,last_success_at=excluded.last_success_at`,
      [b, t, c.updatedAt, c.id, new Date().toISOString()],
    );
  }
}
