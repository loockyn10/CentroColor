/* eslint-disable @typescript-eslint/no-explicit-any -- SQLite plugin returns untyped rows. */
import Database from '@tauri-apps/plugin-sql';
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
const db = () => Database.load('sqlite:centrocolor.db');
const bool = (x: number) => x === 1;
const moulding = (x: any): FrameMoulding => ({
  ...x,
  businessId: x.business_id,
  faceWidthMm: x.face_width_mm,
  costPerMeterCents: x.cost_per_meter_cents,
  salePricePerMeterCents: x.sale_price_per_meter_cents,
  wastePercent: x.waste_percent,
  isActive: bool(x.is_active),
  createdAt: x.created_at,
  updatedAt: x.updated_at,
  code: x.code,
  description: x.description,
});
const material = (x: any): FrameMaterial => ({
  ...x,
  businessId: x.business_id,
  materialType: x.material_type,
  pricingUnit: x.pricing_unit,
  costCents: x.cost_cents,
  salePriceCents: x.sale_price_cents,
  wastePercent: x.waste_percent,
  isActive: bool(x.is_active),
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});
const quote = (x: any): FrameQuote => ({
  ...x,
  businessId: x.business_id,
  branchId: x.branch_id,
  customerId: x.customer_id,
  widthMm: x.width_mm,
  heightMm: x.height_mm,
  measurementMode: x.measurement_mode,
  subtotalCents: x.subtotal_cents,
  totalCents: x.total_cents,
  createdBy: x.created_by,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});
const job = (x: any): FrameJob => ({
  ...x,
  businessId: x.business_id,
  branchId: x.branch_id,
  quoteId: x.quote_id,
  customerId: x.customer_id,
  promisedAt: x.promised_at,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});
export class SQLiteFramingRepository implements FramingRepository {
  async listMouldings(b: string, all = false) {
    return (
      await (
        await db()
      ).select<any[]>(
        `SELECT * FROM frame_mouldings WHERE business_id=? ${all ? '' : 'AND is_active=1'} ORDER BY is_active DESC,name`,
        [b],
      )
    ).map(moulding);
  }
  async createMoulding(x: FrameMoulding) {
    const d = await db();
    await d.execute(
      `INSERT INTO frame_mouldings(id,business_id,code,name,description,face_width_mm,cost_per_meter_cents,sale_price_per_meter_cents,waste_percent,is_active,created_at,updated_at,local_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
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
      ],
    );
    return x;
  }
  async updateMoulding(b: string, id: string, x: any) {
    const d = await db();
    await d.execute(
      `UPDATE frame_mouldings SET code=?,name=?,description=?,face_width_mm=?,cost_per_meter_cents=?,sale_price_per_meter_cents=?,waste_percent=?,updated_at=?,local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [
        x.code,
        x.name,
        x.description,
        x.faceWidthMm,
        x.costPerMeterCents,
        x.salePricePerMeterCents,
        x.wastePercent,
        new Date().toISOString(),
        b,
        id,
      ],
    );
    return (await this.listMouldings(b, true)).find((x) => x.id === id)!;
  }
  async setMouldingActive(b: string, id: string, a: boolean) {
    const d = await db();
    await d.execute(
      `UPDATE frame_mouldings SET is_active=?,updated_at=?,local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [a ? 1 : 0, new Date().toISOString(), b, id],
    );
    return (await this.listMouldings(b, true)).find((x) => x.id === id)!;
  }
  async listMaterials(b: string, all = false) {
    return (
      await (
        await db()
      ).select<any[]>(
        `SELECT * FROM frame_materials WHERE business_id=? ${all ? '' : 'AND is_active=1'} ORDER BY is_active DESC,name`,
        [b],
      )
    ).map(material);
  }
  async createMaterial(x: FrameMaterial) {
    const d = await db();
    await d.execute(
      `INSERT INTO frame_materials(id,business_id,name,material_type,pricing_unit,cost_cents,sale_price_cents,waste_percent,is_active,created_at,updated_at,local_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
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
      ],
    );
    return x;
  }
  async updateMaterial(b: string, id: string, x: any) {
    const d = await db();
    await d.execute(
      `UPDATE frame_materials SET name=?,material_type=?,pricing_unit=?,cost_cents=?,sale_price_cents=?,waste_percent=?,updated_at=?,local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [
        x.name,
        x.materialType,
        x.pricingUnit,
        x.costCents,
        x.salePriceCents,
        x.wastePercent,
        new Date().toISOString(),
        b,
        id,
      ],
    );
    return (await this.listMaterials(b, true)).find((x) => x.id === id)!;
  }
  async setMaterialActive(b: string, id: string, a: boolean) {
    const d = await db();
    await d.execute(
      `UPDATE frame_materials SET is_active=?,updated_at=?,local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [a ? 1 : 0, new Date().toISOString(), b, id],
    );
    return (await this.listMaterials(b, true)).find((x) => x.id === id)!;
  }
  async getSettings(b: string) {
    const d = await db();
    const r = await d.select<any[]>(
      `SELECT * FROM framing_settings WHERE business_id=?`,
      [b],
    );
    if (!r[0]) {
      const x = {
        businessId: b,
        defaultMarkupPercent: 0,
        defaultLabourCents: 0,
        defaultMouldingWastePercent: 0,
        defaultMaterialWastePercent: 0,
        updatedAt: new Date().toISOString(),
      };
      return this.saveSettings(x);
    }
    const x = r[0];
    return {
      businessId: x.business_id,
      defaultMarkupPercent: x.default_markup_percent,
      defaultLabourCents: x.default_labour_cents,
      defaultMouldingWastePercent: x.default_moulding_waste_percent,
      defaultMaterialWastePercent: x.default_material_waste_percent,
      updatedAt: x.updated_at,
    };
  }
  async saveSettings(x: FramingSettings) {
    const d = await db();
    await d.execute(
      `INSERT INTO framing_settings(business_id,default_markup_percent,default_labour_cents,default_moulding_waste_percent,default_material_waste_percent,updated_at,sync_origin,local_revision) VALUES(?,?,?,?,?,?, 'local',1) ON CONFLICT(business_id) DO UPDATE SET default_markup_percent=excluded.default_markup_percent,default_labour_cents=excluded.default_labour_cents,default_moulding_waste_percent=excluded.default_moulding_waste_percent,default_material_waste_percent=excluded.default_material_waste_percent,updated_at=excluded.updated_at,sync_origin='local',local_revision=framing_settings.local_revision+1`,
      [
        x.businessId,
        x.defaultMarkupPercent,
        x.defaultLabourCents,
        x.defaultMouldingWastePercent,
        x.defaultMaterialWastePercent,
        x.updatedAt,
      ],
    );
    return x;
  }
  async listQuotes(b: string, branch: string, statuses?: FrameQuoteStatus[]) {
    const where = statuses?.length
      ? ` AND status IN (${statuses.map(() => '?').join(',')})`
      : '';
    return (
      await (
        await db()
      ).select<any[]>(
        `SELECT * FROM frame_quotes WHERE business_id=? AND branch_id=?${where} ORDER BY updated_at DESC`,
        [b, branch, ...(statuses ?? [])],
      )
    ).map(quote);
  }
  async getQuote(b: string, id: string) {
    const d = await db();
    const q = await d.select<any[]>(
      `SELECT * FROM frame_quotes WHERE business_id=? AND id=?`,
      [b, id],
    );
    if (!q[0]) return null;
    const rows = await d.select<any[]>(
      `SELECT * FROM frame_quote_items WHERE business_id=? AND quote_id=? ORDER BY created_at`,
      [b, id],
    );
    return {
      quote: quote(q[0]),
      items: rows.map((x) => ({
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
        metadata: JSON.parse(x.metadata_json),
        createdAt: x.created_at,
        updatedAt: x.updated_at,
      })),
    };
  }
  async saveQuote(q: FrameQuote, items: FrameQuoteItem[]) {
    const d = await db();
    await d.execute(
      `INSERT INTO frame_quotes(id,business_id,branch_id,customer_id,width_mm,height_mm,measurement_mode,status,notes,subtotal_cents,total_cents,created_by,created_at,updated_at,local_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
        q.id,
        q.businessId,
        q.branchId,
        q.customerId,
        q.widthMm,
        q.heightMm,
        q.measurementMode,
        q.status,
        q.notes,
        q.subtotalCents,
        q.totalCents,
        q.createdBy,
        q.createdAt,
        q.updatedAt,
      ],
    );
    for (const x of items)
      await d.execute(
        `INSERT INTO frame_quote_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
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
        ],
      );
    return q;
  }
  async setQuoteStatus(b: string, id: string, status: FrameQuoteStatus) {
    const d = await db();
    await d.execute(
      `UPDATE frame_quotes SET status=?,updated_at=? WHERE business_id=? AND id=?`,
      [status, new Date().toISOString(), b, id],
    );
    return (await this.getQuote(b, id))!.quote;
  }
  async listJobs(b: string, branch: string, statuses?: FrameJobStatus[]) {
    const w = statuses?.length
      ? ` AND status IN (${statuses.map(() => '?').join(',')})`
      : '';
    return (
      await (
        await db()
      ).select<any[]>(
        `SELECT * FROM frame_jobs WHERE business_id=? AND branch_id=?${w} ORDER BY updated_at DESC`,
        [b, branch, ...(statuses ?? [])],
      )
    ).map(job);
  }
  async createJob(x: FrameJob) {
    const d = await db();
    await d.execute(
      `INSERT INTO frame_jobs(id,business_id,branch_id,quote_id,customer_id,status,promised_at,notes,created_at,updated_at,local_revision) VALUES(?,?,?,?,?,?,?,?,?,?,1)`,
      [
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
      ],
    );
    return x;
  }
  async setJobStatus(b: string, id: string, status: FrameJobStatus) {
    const d = await db();
    await d.execute(
      `UPDATE frame_jobs SET status=?,updated_at=? WHERE business_id=? AND id=?`,
      [status, new Date().toISOString(), b, id],
    );
    const r = await d.select<any[]>(
      `SELECT * FROM frame_jobs WHERE business_id=? AND id=?`,
      [b, id],
    );
    if (!r[0]) throw new Error('No se encontró el trabajo.');
    return job(r[0]);
  }
  async countOpenJobs(b: string, branch: string) {
    const r = await (
      await db()
    ).select<any[]>(
      `SELECT count(*) count FROM frame_jobs WHERE business_id=? AND branch_id=? AND status IN('pending','in_progress','ready')`,
      [b, branch],
    );
    return r[0]?.count ?? 0;
  }
}
