import type { SupabaseClient } from '@supabase/supabase-js';
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
  TravelPricingSettings,
} from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';

type Row = Record<string, unknown>;
const str = (row: Row, key: string) => String(row[key]);
const num = (row: Row, key: string) => Number(row[key]);
const nullable = (row: Row, key: string) =>
  row[key] == null ? null : String(row[key]);

const fromList = (r: Row): PriceList => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  name: str(r, 'name'),
  kind: str(r, 'kind') as PriceList['kind'],
  isDefault: Boolean(r.is_default),
  isActive: Boolean(r.is_active),
  createdAt: str(r, 'created_at'),
  updatedAt: str(r, 'updated_at'),
});
const fromTravelSettings = (r: Row): TravelPricingSettings => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  fuelPriceCentsPerLiter: num(r, 'fuel_price_cents_per_liter'),
  efficiencyMilliKmPerLiter: num(r, 'efficiency_milli_km_per_liter'),
  marginBasisPoints: num(r, 'margin_basis_points'),
});
const fromVariant = (r: Row): LabVariant => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  photoServiceId: str(r, 'photo_service_id'),
  channel: str(r, 'channel') as LabVariant['channel'],
  paper: str(r, 'paper') as LabVariant['paper'],
  isActive: Boolean(r.is_active),
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
  isActive: Boolean(r.is_active),
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
  snapshot: r.snapshot as PlotterQuote['snapshot'],
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
  withProjector: Boolean(r.with_projector),
  primaryResourceId: nullable(r, 'primary_resource_id'),
  projectorResourceId: nullable(r, 'projector_resource_id'),
  isActive: Boolean(r.is_active),
});
const fromOfferRate = (r: Row): EventOfferRate => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  offerId: str(r, 'offer_id'),
  priceListId: str(r, 'price_list_id'),
  amountCents: num(r, 'amount_cents'),
  operatorAmountCents: num(r, 'operator_amount_cents'),
  withProjectorAmountCents:
    r.with_projector_amount_cents == null
      ? null
      : num(r, 'with_projector_amount_cents'),
});
const fromPool = (r: Row): LedPanelPool => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  totalPanels: num(r, 'total_panels'),
  panelAreaMm2: num(r, 'panel_area_mm2'),
  pixelsPerPanel: num(r, 'pixels_per_panel'),
  isActive: Boolean(r.is_active),
});
const fromPreset = (r: Row): LedPreset => ({
  id: str(r, 'id'),
  businessId: str(r, 'business_id'),
  name: str(r, 'name'),
  widthMm: num(r, 'width_mm'),
  heightMm: num(r, 'height_mm'),
  isActive: Boolean(r.is_active),
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
  isActive: Boolean(r.is_active),
});

export class SupabaseServiceCatalogRepository implements ServiceCatalogRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  private async list(table: string, businessId: string): Promise<Row[]> {
    const { data, error } = await this.client
      .from(table)
      .select('*')
      .eq('business_id', businessId);
    if (error) throw error;
    return (data ?? []) as Row[];
  }
  private async save(table: string, row: Row): Promise<Row> {
    const { data, error } = await this.client
      .from(table)
      .upsert(row, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return data as Row;
  }
  async getTravelPricingSettings(businessId: string) {
    return (
      (await this.list('travel_pricing_settings', businessId)).map(
        fromTravelSettings,
      )[0] ?? null
    );
  }
  async saveTravelPricingSettings(x: TravelPricingSettings) {
    return fromTravelSettings(
      await this.save('travel_pricing_settings', {
        id: x.id,
        business_id: x.businessId,
        fuel_price_cents_per_liter: x.fuelPriceCentsPerLiter,
        efficiency_milli_km_per_liter: x.efficiencyMilliKmPerLiter,
        margin_basis_points: x.marginBasisPoints,
      }),
    );
  }
  async listPriceLists(businessId: string) {
    return (await this.list('price_lists', businessId)).map(fromList);
  }
  async savePriceList(x: PriceList) {
    return fromList(
      await this.save('price_lists', {
        id: x.id,
        business_id: x.businessId,
        name: x.name,
        kind: x.kind,
        is_default: x.isDefault,
        is_active: x.isActive,
      }),
    );
  }
  async listLabVariants(businessId: string) {
    return (await this.list('lab_variants', businessId)).map(fromVariant);
  }
  async saveLabVariant(x: LabVariant) {
    return fromVariant(
      await this.save('lab_variants', {
        id: x.id,
        business_id: x.businessId,
        photo_service_id: x.photoServiceId,
        channel: x.channel,
        paper: x.paper,
        is_active: x.isActive,
      }),
    );
  }
  async listLabTiers(businessId: string) {
    return (await this.list('lab_price_tiers', businessId)).map(fromTier);
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
  async listPlotterMaterials(businessId: string) {
    return (await this.list('plotter_materials', businessId)).map(fromMaterial);
  }
  async savePlotterMaterial(x: PlotterMaterial) {
    return fromMaterial(
      await this.save('plotter_materials', {
        id: x.id,
        business_id: x.businessId,
        code: x.code,
        name: x.name,
        roll_width_mm: x.rollWidthMm,
        is_active: x.isActive,
      }),
    );
  }
  async listPlotterRates(businessId: string) {
    return (await this.list('plotter_rates', businessId)).map(fromRate);
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
  async listPlotterQuotes(businessId: string, branchId: string) {
    const { data, error } = await this.client
      .from('plotter_quotes')
      .select('*')
      .eq('business_id', businessId)
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(fromQuote);
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
        snapshot: x.snapshot,
        total_cents: x.totalCents,
        notes: x.notes,
        created_by: x.createdBy,
      }),
    );
  }
  async setPlotterQuoteStatus(
    businessId: string,
    id: string,
    status: PlotterQuoteStatus,
  ) {
    const { data, error } = await this.client
      .from('plotter_quotes')
      .update({ status })
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromQuote(data as Row);
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
        with_projector: x.withProjector,
        primary_resource_id: x.primaryResourceId,
        projector_resource_id: x.projectorResourceId,
        is_active: x.isActive,
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
        operator_amount_cents: x.operatorAmountCents,
        with_projector_amount_cents: x.withProjectorAmountCents,
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
        is_active: x.isActive,
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
        is_active: x.isActive,
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
    const { data, error } = await this.client
      .from('led_panel_reservations')
      .select('*,events!inner(status)')
      .eq('business_id', b)
      .eq('is_active', true)
      .in('events.status', ['reserved', 'completed'])
      .lt('starts_at', to)
      .gt('ends_at', from);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(fromPanelReservation);
  }
  async listEventLedReservations(b: string, eventId: string) {
    const { data, error } = await this.client
      .from('led_panel_reservations')
      .select('*')
      .eq('business_id', b)
      .eq('event_id', eventId);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(fromPanelReservation);
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
        is_active: x.isActive,
      }),
    );
  }
}
