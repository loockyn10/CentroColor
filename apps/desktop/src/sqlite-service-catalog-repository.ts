import Database from '@tauri-apps/plugin-sql';
import type {
  PlotterQuote,
  PlotterQuoteStatus,
  ServiceCatalogRepository,
} from '@centrocolor/application';
import type {
  LabPriceTier,
  LabVariant,
  PlotterMaterial,
  PlotterRate,
  PriceList,
  EventOffer,
  EventOfferRate,
  LedPanelPool,
  LedPreset,
  LedController,
  LedPanelReservation,
} from '@centrocolor/domain';

type Row = Record<string, unknown>;
const str = (r: Row, k: string) => String(r[k]);
const num = (r: Row, k: string) => Number(r[k]);
const nullable = (r: Row, k: string) => (r[k] == null ? null : String(r[k]));
const bool = (r: Row, k: string) => r[k] === 1;
const fromList = (r: Row): PriceList => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  name: str(r, 'name'),
  kind: str(r, 'kind') as PriceList['kind'],
  isDefault: bool(r, 'is_default'),
  isActive: bool(r, 'is_active'),
  createdAt: str(r, 'created_at'),
  updatedAt: str(r, 'updated_at'),
});
const fromVariant = (r: Row): LabVariant => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  photoServiceId: str(r, 'photo_service_id'),
  channel: str(r, 'channel') as LabVariant['channel'],
  paper: str(r, 'paper') as LabVariant['paper'],
  isActive: bool(r, 'is_active'),
});
const fromTier = (r: Row): LabPriceTier => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  variantId: str(r, 'variant_id'),
  priceListId: str(r, 'price_list_id'),
  minQuantity: num(r, 'min_quantity'),
  maxQuantity: r.max_quantity == null ? null : num(r, 'max_quantity'),
  unitPriceCents: num(r, 'unit_price_cents'),
});
const fromMaterial = (r: Row): PlotterMaterial => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  code: str(r, 'code') as PlotterMaterial['code'],
  name: str(r, 'name'),
  rollWidthMm: r.roll_width_mm == null ? null : num(r, 'roll_width_mm'),
  isActive: bool(r, 'is_active'),
});
const fromRate = (r: Row): PlotterRate => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  priceListId: str(r, 'price_list_id'),
  code: str(r, 'code'),
  amountCents: num(r, 'amount_cents'),
  widthMm: r.width_mm == null ? null : num(r, 'width_mm'),
  heightMm: r.height_mm == null ? null : num(r, 'height_mm'),
});
const fromQuote = (r: Row): PlotterQuote => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  branchId: str(r, 'branch_id'),
  customerId: nullable(r, 'customer_id'),
  priceListId: str(r, 'price_list_id'),
  status: str(r, 'status') as PlotterQuoteStatus,
  snapshot: JSON.parse(str(r, 'snapshot')) as PlotterQuote['snapshot'],
  totalCents: num(r, 'total_cents'),
  notes: nullable(r, 'notes'),
  createdBy: str(r, 'created_by'),
  createdAt: str(r, 'created_at'),
  updatedAt: str(r, 'updated_at'),
});
const fromOffer = (r: Row): EventOffer => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  kind: str(r, 'kind') as EventOffer['kind'],
  name: str(r, 'name'),
  widthMm: r.width_mm == null ? null : num(r, 'width_mm'),
  heightMm: r.height_mm == null ? null : num(r, 'height_mm'),
  projection: nullable(r, 'projection') as EventOffer['projection'],
  withProjector: bool(r, 'with_projector'),
  primaryResourceId: nullable(r, 'primary_resource_id'),
  projectorResourceId: nullable(r, 'projector_resource_id'),
  isActive: bool(r, 'is_active'),
});
const fromOfferRate = (r: Row): EventOfferRate => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  offerId: str(r, 'offer_id'),
  priceListId: str(r, 'price_list_id'),
  amountCents: num(r, 'amount_cents'),
});
const fromPool = (r: Row): LedPanelPool => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  totalPanels: num(r, 'total_panels'),
  panelAreaMm2: num(r, 'panel_area_mm2'),
  pixelsPerPanel: num(r, 'pixels_per_panel'),
  isActive: bool(r, 'is_active'),
});
const fromPreset = (r: Row): LedPreset => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  name: str(r, 'name'),
  widthMm: num(r, 'width_mm'),
  heightMm: num(r, 'height_mm'),
  isActive: bool(r, 'is_active'),
});
const fromController = (r: Row): LedController => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  resourceId: str(r, 'resource_id'),
  maxPixels: r.max_pixels == null ? null : num(r, 'max_pixels'),
});
const fromPanelReservation = (r: Row): LedPanelReservation => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  eventId: str(r, 'event_id'),
  eventServiceItemId: str(r, 'event_service_item_id'),
  controllerResourceId: str(r, 'controller_resource_id'),
  startsAt: str(r, 'starts_at'),
  endsAt: str(r, 'ends_at'),
  panels: num(r, 'panels'),
  isActive: bool(r, 'is_active'),
});

const tables = [
  'price_lists',
  'lab_variants',
  'lab_price_tiers',
  'plotter_materials',
  'plotter_rates',
  'plotter_quotes',
  'event_offers',
  'event_offer_rates',
  'led_panel_pools',
  'led_presets',
  'led_controllers',
  'led_panel_reservations',
] as const;
type Table = (typeof tables)[number];
export class SQLiteServiceCatalogRepository implements ServiceCatalogRepository {
  private async db() {
    return Database.load('sqlite:centrocolor.db');
  }
  private async list(table: Table, businessId: string): Promise<Row[]> {
    const db = await this.db();
    return db.select<Row[]>(
      `SELECT * FROM ${table} WHERE business_id=? ORDER BY created_at,id`,
      [businessId],
    );
  }
  private async get(
    table: Table,
    businessId: string,
    id: string,
  ): Promise<Row> {
    const rows = await (
      await this.db()
    ).select<Row[]>(`SELECT * FROM ${table} WHERE business_id=? AND id=?`, [
      businessId,
      id,
    ]);
    if (!rows[0]) throw new Error('No se encontró el registro.');
    return rows[0];
  }
  private async save(table: Table, row: Row): Promise<Row> {
    const db = await this.db();
    const now = new Date().toISOString();
    const fields = Object.keys(row).filter(
      (k) => !['created_at', 'updated_at'].includes(k),
    );
    // Column names are interpolated into SQL: only internal snake_case names pass.
    if (
      !tables.includes(table) ||
      !fields.every((k) => /^[a-z][a-z_]*$/.test(k))
    )
      throw new Error('Registro de catálogo inválido.');
    const keys = [
      ...fields,
      'created_at',
      'updated_at',
      'sync_origin',
      'local_revision',
    ];
    const values = [
      ...fields.map((k) => row[k]),
      row.created_at ?? now,
      now,
      'local',
      1,
    ];
    const update = fields
      .filter((k) => !['id', 'business_id'].includes(k))
      .map((k) => `${k}=excluded.${k}`)
      .join(',');
    const result = await db.execute(
      `INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})
       ON CONFLICT(id) DO UPDATE SET ${update},updated_at=excluded.updated_at,
       sync_origin='local',local_revision=${table}.local_revision+1
       WHERE ${table}.business_id=excluded.business_id`,
      values,
    );
    if (!result.rowsAffected)
      throw new Error('El registro pertenece a otro negocio.');
    return this.get(table, String(row.business_id), String(row.id));
  }
  async listPriceLists(b: string) {
    return (await this.list('price_lists', b)).map(fromList);
  }
  async savePriceList(x: PriceList) {
    return fromList(
      await this.save('price_lists', {
        id: x.id,
        business_id: x.businessId,
        name: x.name,
        kind: x.kind,
        is_default: x.isDefault ? 1 : 0,
        is_active: x.isActive ? 1 : 0,
        created_at: x.createdAt,
      }),
    );
  }
  async listLabVariants(b: string) {
    return (await this.list('lab_variants', b)).map(fromVariant);
  }
  async saveLabVariant(x: LabVariant) {
    return fromVariant(
      await this.save('lab_variants', {
        id: x.id,
        business_id: x.businessId,
        photo_service_id: x.photoServiceId,
        channel: x.channel,
        paper: x.paper,
        is_active: x.isActive ? 1 : 0,
      }),
    );
  }
  async listLabTiers(b: string) {
    return (await this.list('lab_price_tiers', b)).map(fromTier);
  }
  async saveLabTier(x: LabPriceTier) {
    return fromTier(
      await this.save('lab_price_tiers', {
        id: x.id,
        business_id: x.businessId,
        variant_id: x.variantId,
        price_list_id: x.priceListId,
        min_quantity: x.minQuantity,
        max_quantity: x.maxQuantity,
        unit_price_cents: x.unitPriceCents,
      }),
    );
  }
  async listPlotterMaterials(b: string) {
    return (await this.list('plotter_materials', b)).map(fromMaterial);
  }
  async savePlotterMaterial(x: PlotterMaterial) {
    return fromMaterial(
      await this.save('plotter_materials', {
        id: x.id,
        business_id: x.businessId,
        code: x.code,
        name: x.name,
        roll_width_mm: x.rollWidthMm,
        is_active: x.isActive ? 1 : 0,
      }),
    );
  }
  async listPlotterRates(b: string) {
    return (await this.list('plotter_rates', b)).map(fromRate);
  }
  async savePlotterRate(x: PlotterRate) {
    return fromRate(
      await this.save('plotter_rates', {
        id: x.id,
        business_id: x.businessId,
        price_list_id: x.priceListId,
        code: x.code,
        amount_cents: x.amountCents,
        width_mm: x.widthMm,
        height_mm: x.heightMm,
      }),
    );
  }
  async listPlotterQuotes(b: string, branchId: string) {
    const rows = await (
      await this.db()
    ).select<Row[]>(
      'SELECT * FROM plotter_quotes WHERE business_id=? AND branch_id=? ORDER BY created_at DESC LIMIT 200',
      [b, branchId],
    );
    return rows.map(fromQuote);
  }
  async savePlotterQuote(x: PlotterQuote) {
    return fromQuote(
      await this.save('plotter_quotes', {
        id: x.id,
        business_id: x.businessId,
        branch_id: x.branchId,
        customer_id: x.customerId,
        price_list_id: x.priceListId,
        status: x.status,
        snapshot: JSON.stringify(x.snapshot),
        total_cents: x.totalCents,
        notes: x.notes,
        created_by: x.createdBy,
        created_at: x.createdAt,
      }),
    );
  }
  async setPlotterQuoteStatus(
    b: string,
    id: string,
    status: PlotterQuoteStatus,
  ) {
    const db = await this.db();
    const result = await db.execute(
      "UPDATE plotter_quotes SET status=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?",
      [status, new Date().toISOString(), b, id],
    );
    if (!result.rowsAffected) throw new Error('No se encontró la cotización.');
    return fromQuote(await this.get('plotter_quotes', b, id));
  }
  async listEventOffers(b: string) {
    return (await this.list('event_offers', b)).map(fromOffer);
  }
  async saveEventOffer(x: EventOffer) {
    return fromOffer(
      await this.save('event_offers', {
        id: x.id,
        business_id: x.businessId,
        kind: x.kind,
        name: x.name,
        width_mm: x.widthMm,
        height_mm: x.heightMm,
        projection: x.projection,
        with_projector: x.withProjector ? 1 : 0,
        primary_resource_id: x.primaryResourceId,
        projector_resource_id: x.projectorResourceId,
        is_active: x.isActive ? 1 : 0,
      }),
    );
  }
  async listEventOfferRates(b: string) {
    return (await this.list('event_offer_rates', b)).map(fromOfferRate);
  }
  async saveEventOfferRate(x: EventOfferRate) {
    return fromOfferRate(
      await this.save('event_offer_rates', {
        id: x.id,
        business_id: x.businessId,
        offer_id: x.offerId,
        price_list_id: x.priceListId,
        amount_cents: x.amountCents,
      }),
    );
  }
  async getLedPanelPool(b: string) {
    return (await this.list('led_panel_pools', b)).map(fromPool)[0] ?? null;
  }
  async saveLedPanelPool(x: LedPanelPool) {
    return fromPool(
      await this.save('led_panel_pools', {
        id: x.id,
        business_id: x.businessId,
        total_panels: x.totalPanels,
        panel_area_mm2: x.panelAreaMm2,
        pixels_per_panel: x.pixelsPerPanel,
        is_active: x.isActive ? 1 : 0,
      }),
    );
  }
  async listLedPresets(b: string) {
    return (await this.list('led_presets', b)).map(fromPreset);
  }
  async saveLedPreset(x: LedPreset) {
    return fromPreset(
      await this.save('led_presets', {
        id: x.id,
        business_id: x.businessId,
        name: x.name,
        width_mm: x.widthMm,
        height_mm: x.heightMm,
        is_active: x.isActive ? 1 : 0,
      }),
    );
  }
  async listLedControllers(b: string) {
    return (await this.list('led_controllers', b)).map(fromController);
  }
  async saveLedController(x: LedController) {
    return fromController(
      await this.save('led_controllers', {
        id: x.id,
        business_id: x.businessId,
        resource_id: x.resourceId,
        max_pixels: x.maxPixels,
      }),
    );
  }
  async listLedPanelReservations(b: string, from: string, to: string) {
    const rows = await (
      await this.db()
    ).select<Row[]>(
      `SELECT r.* FROM led_panel_reservations r
      JOIN events e ON e.business_id=r.business_id AND e.id=r.event_id
      WHERE r.business_id=? AND r.is_active=1 AND e.status IN('reserved','completed')
      AND julianday(r.starts_at)<julianday(?) AND julianday(r.ends_at)>julianday(?)`,
      [b, to, from],
    );
    return rows.map(fromPanelReservation);
  }
  async listEventLedReservations(b: string, eventId: string) {
    const rows = await (
      await this.db()
    ).select<Row[]>(
      'SELECT * FROM led_panel_reservations WHERE business_id=? AND event_id=?',
      [b, eventId],
    );
    return rows.map(fromPanelReservation);
  }
  async saveLedPanelReservation(x: LedPanelReservation) {
    return fromPanelReservation(
      await this.save('led_panel_reservations', {
        id: x.id,
        business_id: x.businessId,
        event_id: x.eventId,
        event_service_item_id: x.eventServiceItemId,
        controller_resource_id: x.controllerResourceId,
        starts_at: x.startsAt,
        ends_at: x.endsAt,
        panels: x.panels,
        is_active: x.isActive ? 1 : 0,
      }),
    );
  }
}
