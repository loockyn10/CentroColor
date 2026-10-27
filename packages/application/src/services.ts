import type {
  LabPriceTier,
  LabVariant,
  PlotterMaterial,
  PlotterQuoteSnapshot,
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

export type PlotterQuoteStatus =
  'draft' | 'quoted' | 'accepted' | 'cancelled' | 'completed';
export interface PlotterQuote {
  id: string;
  businessId: string;
  branchId: string;
  customerId: string | null;
  priceListId: string;
  status: PlotterQuoteStatus;
  snapshot: PlotterQuoteSnapshot;
  totalCents: number;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Implemented by each app. No UI, SQL or Supabase dependency crosses this boundary. */
export interface ServiceCatalogRepository {
  getTravelPricingSettings(
    businessId: string,
  ): Promise<TravelPricingSettings | null>;
  saveTravelPricingSettings(
    settings: TravelPricingSettings,
  ): Promise<TravelPricingSettings>;
  listPriceLists(businessId: string): Promise<PriceList[]>;
  savePriceList(list: PriceList): Promise<PriceList>;
  listLabVariants(businessId: string): Promise<LabVariant[]>;
  saveLabVariant(variant: LabVariant): Promise<LabVariant>;
  listLabTiers(businessId: string): Promise<LabPriceTier[]>;
  saveLabTier(tier: LabPriceTier): Promise<LabPriceTier>;
  listPlotterMaterials(businessId: string): Promise<PlotterMaterial[]>;
  savePlotterMaterial(material: PlotterMaterial): Promise<PlotterMaterial>;
  listPlotterRates(businessId: string): Promise<PlotterRate[]>;
  savePlotterRate(rate: PlotterRate): Promise<PlotterRate>;
  listPlotterQuotes(
    businessId: string,
    branchId: string,
  ): Promise<PlotterQuote[]>;
  savePlotterQuote(quote: PlotterQuote): Promise<PlotterQuote>;
  setPlotterQuoteStatus(
    businessId: string,
    id: string,
    status: PlotterQuoteStatus,
  ): Promise<PlotterQuote>;
  listEventOffers(businessId: string): Promise<EventOffer[]>;
  saveEventOffer(offer: EventOffer): Promise<EventOffer>;
  listEventOfferRates(businessId: string): Promise<EventOfferRate[]>;
  saveEventOfferRate(rate: EventOfferRate): Promise<EventOfferRate>;
  getLedPanelPool(businessId: string): Promise<LedPanelPool | null>;
  saveLedPanelPool(pool: LedPanelPool): Promise<LedPanelPool>;
  listLedPresets(businessId: string): Promise<LedPreset[]>;
  saveLedPreset(preset: LedPreset): Promise<LedPreset>;
  listLedControllers(businessId: string): Promise<LedController[]>;
  saveLedController(controller: LedController): Promise<LedController>;
  listLedPanelReservations(
    businessId: string,
    from: string,
    to: string,
  ): Promise<LedPanelReservation[]>;
  listEventLedReservations(
    businessId: string,
    eventId: string,
  ): Promise<LedPanelReservation[]>;
  saveLedPanelReservation(
    reservation: LedPanelReservation,
  ): Promise<LedPanelReservation>;
}
