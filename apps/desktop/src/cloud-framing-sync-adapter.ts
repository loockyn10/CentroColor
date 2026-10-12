/* eslint-disable @typescript-eslint/no-explicit-any -- isolated Supabase payload mapping. */
import type {
  FramingSyncCloudPort,
  FramingSyncType,
  PendingFramingChange,
  FramingCursor,
} from '@centrocolor/application';
import { getSupabaseClient } from './cloud-config';
const table = (t: FramingSyncType) =>
  ({
    moulding: 'frame_mouldings',
    material: 'frame_materials',
    settings: 'framing_settings',
    quote: 'frame_quotes',
    quote_item: 'frame_quote_items',
    job: 'frame_jobs',
  })[t];
const fields = (t: FramingSyncType, x: any) =>
  t === 'moulding'
    ? {
        id: x.id,
        business_id: x.businessId,
        code: x.code,
        name: x.name,
        description: x.description,
        face_width_mm: x.faceWidthMm,
        cost_per_meter_cents: x.costPerMeterCents,
        sale_price_per_meter_cents: x.salePricePerMeterCents,
        waste_percent: x.wastePercent,
        is_active: x.isActive,
        created_at: x.createdAt,
      }
    : t === 'material'
      ? {
          id: x.id,
          business_id: x.businessId,
          name: x.name,
          material_type: x.materialType,
          pricing_unit: x.pricingUnit,
          cost_cents: x.costCents,
          sale_price_cents: x.salePriceCents,
          waste_percent: x.wastePercent,
          is_active: x.isActive,
          created_at: x.createdAt,
        }
      : t === 'settings'
        ? {
            business_id: x.businessId,
            default_markup_percent: x.defaultMarkupPercent,
            default_labour_cents: x.defaultLabourCents,
            default_moulding_waste_percent: x.defaultMouldingWastePercent,
            default_material_waste_percent: x.defaultMaterialWastePercent,
          }
        : t === 'quote'
          ? {
              id: x.id,
              business_id: x.businessId,
              branch_id: x.branchId,
              customer_id: x.customerId,
              width_mm: x.widthMm,
              height_mm: x.heightMm,
              measurement_mode: x.measurementMode,
              status: x.status,
              notes: x.notes,
              subtotal_cents: x.subtotalCents,
              total_cents: x.totalCents,
              created_by: x.createdBy,
              created_at: x.createdAt,
            }
          : t === 'quote_item'
            ? {
                id: x.id,
                business_id: x.businessId,
                quote_id: x.quoteId,
                item_type: x.itemType,
                source_id: x.sourceId,
                name_snapshot: x.nameSnapshot,
                quantity_numerator: x.quantityNumerator,
                quantity_denominator: x.quantityDenominator,
                unit: x.unit,
                unit_price_cents: x.unitPriceCents,
                total_cents: x.totalCents,
                metadata: x.metadata,
                created_at: x.createdAt,
              }
            : {
                id: x.id,
                business_id: x.businessId,
                branch_id: x.branchId,
                quote_id: x.quoteId,
                customer_id: x.customerId,
                status: x.status,
                promised_at: x.promisedAt,
                notes: x.notes,
                created_at: x.createdAt,
              };
const decode = (t: FramingSyncType, r: any): any => {
  const b = {
    id: r.id ?? r.business_id,
    businessId: r.business_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (t === 'moulding')
    return {
      ...b,
      code: r.code,
      name: r.name,
      description: r.description,
      faceWidthMm: r.face_width_mm,
      costPerMeterCents: r.cost_per_meter_cents,
      salePricePerMeterCents: r.sale_price_per_meter_cents,
      wastePercent: r.waste_percent,
      isActive: r.is_active,
    };
  if (t === 'material')
    return {
      ...b,
      name: r.name,
      materialType: r.material_type,
      pricingUnit: r.pricing_unit,
      costCents: r.cost_cents,
      salePriceCents: r.sale_price_cents,
      wastePercent: r.waste_percent,
      isActive: r.is_active,
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
      ...b,
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
      ...b,
      quoteId: r.quote_id,
      itemType: r.item_type,
      sourceId: r.source_id,
      nameSnapshot: r.name_snapshot,
      quantityNumerator: r.quantity_numerator,
      quantityDenominator: r.quantity_denominator,
      unit: r.unit,
      unitPriceCents: r.unit_price_cents,
      totalCents: r.total_cents,
      metadata: r.metadata,
    };
  return {
    ...b,
    branchId: r.branch_id,
    quoteId: r.quote_id,
    customerId: r.customer_id,
    status: r.status,
    promisedAt: r.promised_at,
    notes: r.notes,
  };
};
export class CloudFramingSyncAdapter implements FramingSyncCloudPort {
  async push(t: FramingSyncType, c: PendingFramingChange) {
    const client: any = getSupabaseClient(),
      x: any = c.entity,
      id = x.id ?? x.businessId;
    const q = client
      .from(table(t))
      .select('*')
      .eq('business_id', x.businessId)
      .eq(t === 'settings' ? 'business_id' : 'id', id)
      .maybeSingle();
    const old = await q;
    if (old.error) throw old.error;
    if (
      old.data &&
      c.cloudUpdatedAt &&
      old.data.updated_at !== c.cloudUpdatedAt
    )
      return { kind: 'conflict' as const, entity: decode(t, old.data) };
    const payload = fields(t, x);
    const result = old.data
      ? await client
          .from(table(t))
          .update(payload)
          .eq('business_id', x.businessId)
          .eq(t === 'settings' ? 'business_id' : 'id', id)
          .select('*')
          .single()
      : await client.from(table(t)).insert(payload).select('*').single();
    if (result.error) throw result.error;
    return { kind: 'pushed' as const, entity: decode(t, result.data) };
  }
  async pull(
    t: FramingSyncType,
    b: string,
    after: FramingCursor | null,
    limit: number,
  ) {
    const client: any = getSupabaseClient();
    let q = client
      .from(table(t))
      .select('*')
      .eq('business_id', b)
      .order('updated_at')
      .order(t === 'settings' ? 'business_id' : 'id')
      .limit(limit);
    if (after)
      q = q.or(
        `updated_at.gt.${after.updatedAt},and(updated_at.eq.${after.updatedAt},${t === 'settings' ? 'business_id' : 'id'}.gt.${after.id})`,
      );
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r: any) => decode(t, r));
  }
}
