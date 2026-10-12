/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase row mapping is isolated here. */
import type { FramingRepository } from '@centrocolor/application';
import type {
  FrameJob,
  FrameJobStatus,
  FrameMaterial,
  FrameMoulding,
  FrameQuote,
  FrameQuoteItem,
  FrameQuoteStatus,
  FramingSettings,
} from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';
const c = () => getSupabaseClient();
const moulding = (x: any): FrameMoulding => ({
  id: x.id,
  businessId: x.business_id,
  code: x.code,
  name: x.name,
  description: x.description,
  faceWidthMm: x.face_width_mm,
  costPerMeterCents: x.cost_per_meter_cents,
  salePricePerMeterCents: x.sale_price_per_meter_cents,
  wastePercent: x.waste_percent,
  isActive: x.is_active,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});
const material = (x: any): FrameMaterial => ({
  id: x.id,
  businessId: x.business_id,
  name: x.name,
  materialType: x.material_type,
  pricingUnit: x.pricing_unit,
  costCents: x.cost_cents,
  salePriceCents: x.sale_price_cents,
  wastePercent: x.waste_percent,
  isActive: x.is_active,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});
const quote = (x: any): FrameQuote => ({
  id: x.id,
  businessId: x.business_id,
  branchId: x.branch_id,
  customerId: x.customer_id,
  widthMm: x.width_mm,
  heightMm: x.height_mm,
  measurementMode: x.measurement_mode,
  status: x.status,
  notes: x.notes,
  subtotalCents: x.subtotal_cents,
  totalCents: x.total_cents,
  createdBy: x.created_by,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});
const job = (x: any): FrameJob => ({
  id: x.id,
  businessId: x.business_id,
  branchId: x.branch_id,
  quoteId: x.quote_id,
  customerId: x.customer_id,
  status: x.status,
  promisedAt: x.promised_at,
  notes: x.notes,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});
export class SupabaseFramingRepository implements FramingRepository {
  private async one(q: any) {
    const { data, error } = await q.select('*').single();
    if (error) throw error;
    return data;
  }
  async listMouldings(b: string, all = false) {
    let q = c()
      .from('frame_mouldings')
      .select('*')
      .eq('business_id', b)
      .order('name');
    if (!all) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(moulding);
  }
  async createMoulding(x: FrameMoulding) {
    return moulding(
      await this.one(
        c().from('frame_mouldings').insert({
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
        }),
      ),
    );
  }
  async updateMoulding(b: string, id: string, x: any) {
    return moulding(
      await this.one(
        c()
          .from('frame_mouldings')
          .update({
            code: x.code,
            name: x.name,
            description: x.description,
            face_width_mm: x.faceWidthMm,
            cost_per_meter_cents: x.costPerMeterCents,
            sale_price_per_meter_cents: x.salePricePerMeterCents,
            waste_percent: x.wastePercent,
          })
          .eq('business_id', b)
          .eq('id', id),
      ),
    );
  }
  async setMouldingActive(b: string, id: string, a: boolean) {
    return moulding(
      await this.one(
        c()
          .from('frame_mouldings')
          .update({ is_active: a })
          .eq('business_id', b)
          .eq('id', id),
      ),
    );
  }
  async listMaterials(b: string, all = false) {
    let q = c()
      .from('frame_materials')
      .select('*')
      .eq('business_id', b)
      .order('name');
    if (!all) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(material);
  }
  async createMaterial(x: FrameMaterial) {
    return material(
      await this.one(
        c().from('frame_materials').insert({
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
        }),
      ),
    );
  }
  async updateMaterial(b: string, id: string, x: any) {
    return material(
      await this.one(
        c()
          .from('frame_materials')
          .update({
            name: x.name,
            material_type: x.materialType,
            pricing_unit: x.pricingUnit,
            cost_cents: x.costCents,
            sale_price_cents: x.salePriceCents,
            waste_percent: x.wastePercent,
          })
          .eq('business_id', b)
          .eq('id', id),
      ),
    );
  }
  async setMaterialActive(b: string, id: string, a: boolean) {
    return material(
      await this.one(
        c()
          .from('frame_materials')
          .update({ is_active: a })
          .eq('business_id', b)
          .eq('id', id),
      ),
    );
  }
  async getSettings(b: string) {
    const { data, error } = await c()
      .from('framing_settings')
      .select('*')
      .eq('business_id', b)
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return this.saveSettings({
        businessId: b,
        defaultMarkupPercent: 0,
        defaultLabourCents: 0,
        defaultMouldingWastePercent: 0,
        defaultMaterialWastePercent: 0,
        updatedAt: new Date().toISOString(),
      });
    return {
      businessId: b,
      defaultMarkupPercent: data.default_markup_percent,
      defaultLabourCents: data.default_labour_cents,
      defaultMouldingWastePercent: data.default_moulding_waste_percent,
      defaultMaterialWastePercent: data.default_material_waste_percent,
      updatedAt: data.updated_at,
    };
  }
  async saveSettings(x: FramingSettings) {
    const { error } = await c().from('framing_settings').upsert({
      business_id: x.businessId,
      default_markup_percent: x.defaultMarkupPercent,
      default_labour_cents: x.defaultLabourCents,
      default_moulding_waste_percent: x.defaultMouldingWastePercent,
      default_material_waste_percent: x.defaultMaterialWastePercent,
      updated_at: x.updatedAt,
    });
    if (error) throw error;
    return x;
  }
  async listQuotes(b: string, branch: string, statuses?: FrameQuoteStatus[]) {
    let q = c()
      .from('frame_quotes')
      .select('*')
      .eq('business_id', b)
      .eq('branch_id', branch)
      .order('updated_at', { ascending: false });
    if (statuses?.length) q = q.in('status', statuses);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(quote);
  }
  async getQuote(b: string, id: string) {
    const { data, error } = await c()
      .from('frame_quotes')
      .select('*')
      .eq('business_id', b)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const r = await c()
      .from('frame_quote_items')
      .select('*')
      .eq('business_id', b)
      .eq('quote_id', id)
      .order('created_at');
    if (r.error) throw r.error;
    return {
      quote: quote(data),
      items: (r.data ?? []).map((x: any) => ({
        id: x.id,
        businessId: x.business_id,
        quoteId: x.quote_id,
        itemType: x.item_type,
        sourceId: x.source_id,
        nameSnapshot: x.name_snapshot,
        quantityNumerator: x.quantity_numerator,
        quantityDenominator: x.quantity_denominator,
        unit: x.unit,
        unitPriceCents: x.unit_price_cents,
        totalCents: x.total_cents,
        metadata: x.metadata,
        createdAt: x.created_at,
        updatedAt: x.updated_at,
      })),
    };
  }
  async saveQuote(q: FrameQuote, items: FrameQuoteItem[]) {
    const row = await this.one(
      c().from('frame_quotes').insert({
        id: q.id,
        business_id: q.businessId,
        branch_id: q.branchId,
        customer_id: q.customerId,
        width_mm: q.widthMm,
        height_mm: q.heightMm,
        measurement_mode: q.measurementMode,
        status: q.status,
        notes: q.notes,
        subtotal_cents: q.subtotalCents,
        total_cents: q.totalCents,
        created_by: q.createdBy,
        created_at: q.createdAt,
      }),
    );
    const { error } = await c()
      .from('frame_quote_items')
      .insert(
        items.map((x) => ({
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
          updated_at: x.updatedAt,
        })),
      );
    if (error) throw error;
    return quote(row);
  }
  async setQuoteStatus(b: string, id: string, status: FrameQuoteStatus) {
    return quote(
      await this.one(
        c()
          .from('frame_quotes')
          .update({ status })
          .eq('business_id', b)
          .eq('id', id),
      ),
    );
  }
  async listJobs(b: string, branch: string, statuses?: FrameJobStatus[]) {
    let q = c()
      .from('frame_jobs')
      .select('*')
      .eq('business_id', b)
      .eq('branch_id', branch)
      .order('updated_at', { ascending: false });
    if (statuses?.length) q = q.in('status', statuses);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(job);
  }
  async createJob(x: FrameJob) {
    return job(
      await this.one(
        c().from('frame_jobs').insert({
          id: x.id,
          business_id: x.businessId,
          branch_id: x.branchId,
          quote_id: x.quoteId,
          customer_id: x.customerId,
          status: x.status,
          promised_at: x.promisedAt,
          notes: x.notes,
          created_at: x.createdAt,
          updated_at: x.updatedAt,
        }),
      ),
    );
  }
  async setJobStatus(b: string, id: string, status: FrameJobStatus) {
    return job(
      await this.one(
        c()
          .from('frame_jobs')
          .update({ status })
          .eq('business_id', b)
          .eq('id', id),
      ),
    );
  }
  async countOpenJobs(b: string, branch: string) {
    const { count, error } = await c()
      .from('frame_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', b)
      .eq('branch_id', branch)
      .in('status', ['pending', 'in_progress', 'ready']);
    if (error) throw error;
    return count ?? 0;
  }
}
