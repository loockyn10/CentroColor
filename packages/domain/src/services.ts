import { requireCents } from './product';

/** All dimensions are integral millimetres and all money is integral cents. */
export type PriceListKind = 'public' | 'professional' | 'custom';
export interface PriceList {
  id: string;
  businessId: string;
  name: string;
  kind: PriceListKind;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function effectivePriceListId(
  customer: { priceListId?: string | null } | null,
  lists: PriceList[],
  publicPortal = false,
): string {
  const defaultList = lists.find((list) => list.isDefault && list.isActive);
  if (!defaultList)
    throw new Error('Configurá la lista pública antes de cotizar.');
  if (publicPortal) return defaultList.id;
  return (
    lists.find((list) => list.id === customer?.priceListId && list.isActive)
      ?.id ?? defaultList.id
  );
}

export type LabPaper = 'glossy' | 'matte';
export type LabChannel = 'laboratory' | 'kiosk';
export interface LabVariant {
  id: string;
  businessId: string;
  photoServiceId: string;
  channel: LabChannel;
  paper: LabPaper;
  isActive: boolean;
}
export interface LabPriceTier {
  id: string;
  businessId: string;
  variantId: string;
  priceListId: string;
  minQuantity: number;
  maxQuantity: number | null;
  unitPriceCents: number;
}

export function labUnitPrice(
  variant: LabVariant,
  tiers: LabPriceTier[],
  priceListId: string,
  quantity: number,
): number {
  if (!variant.isActive) throw new Error('Esta variante no está disponible.');
  if (!Number.isSafeInteger(quantity) || quantity < 1)
    throw new Error('La cantidad debe ser positiva.');
  const tier = tiers.find(
    (row) =>
      row.variantId === variant.id &&
      row.priceListId === priceListId &&
      row.minQuantity <= quantity &&
      (row.maxQuantity === null || quantity <= row.maxQuantity),
  );
  if (!tier) throw new Error('No hay una tarifa para esta cantidad y lista.');
  return requireCents(tier.unitPriceCents);
}

export type PlotterMaterialCode =
  | 'canvas'
  | 'photo_paper'
  | 'plain_paper'
  | 'adhesive_vinyl'
  | 'front_banner'
  | 'blackout_banner';
export interface PlotterMaterial {
  id: string;
  businessId: string;
  code: PlotterMaterialCode;
  name: string;
  rollWidthMm: number | null;
  isActive: boolean;
}
export interface PlotterRate {
  id: string;
  businessId: string;
  priceListId: string;
  code: string;
  /** MATERIAL codes use cents/m²; ROD uses cents/m; MDF uses cents/m². */
  amountCents: number;
  widthMm: number | null;
  heightMm: number | null;
}

export function squareMillimeters(widthMm: number, heightMm: number): number {
  if (![widthMm, heightMm].every((n) => Number.isSafeInteger(n) && n > 0))
    throw new Error('Ingresá medidas positivas en milímetros.');
  const area = widthMm * heightMm;
  if (!Number.isSafeInteger(area)) throw new Error('Área fuera de rango.');
  return area;
}

export function areaPriceCents(
  widthMm: number,
  heightMm: number,
  centsPerSquareMeter: number,
): number {
  const numerator =
    BigInt(squareMillimeters(widthMm, heightMm)) *
    BigInt(requireCents(centsPerSquareMeter));
  const result = (numerator + 500_000n) / 1_000_000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Precio fuera de rango.');
  return Number(result);
}

export function rollFit(
  widthMm: number,
  heightMm: number,
  rollWidthMm: number | null,
): 'unknown' | 'normal' | 'rotated' | 'no_fit' {
  squareMillimeters(widthMm, heightMm);
  if (rollWidthMm === null) return 'unknown';
  if (!Number.isSafeInteger(rollWidthMm) || rollWidthMm <= 0)
    throw new Error('Ancho de rollo inválido.');
  if (widthMm <= rollWidthMm) return 'normal';
  if (heightMm <= rollWidthMm) return 'rotated';
  return 'no_fit';
}

export interface PlotterQuoteInput {
  material: PlotterMaterial;
  widthMm: number;
  heightMm: number;
  quantity: number;
  priceListId: string;
  mdf: boolean;
  canvasStretcher: boolean;
  rods: 0 | 1 | 2;
  fold: 'none' | 'top' | 'both';
  notes: string | null;
}
export interface QuoteLine {
  code: string;
  description: string;
  amountCents: number;
}
export interface PlotterQuoteSnapshot {
  priceListId: string;
  materialCode: PlotterMaterialCode;
  materialName: string;
  widthMm: number;
  heightMm: number;
  quantity: number;
  areaMm2: number;
  rollFit: ReturnType<typeof rollFit>;
  notes: string | null;
  lines: QuoteLine[];
  totalCents: number;
}

export function quotePlotter(
  input: PlotterQuoteInput,
  rates: PlotterRate[],
): PlotterQuoteSnapshot {
  if (!input.material.isActive)
    throw new Error('El material no está disponible.');
  const areaMm2 = squareMillimeters(input.widthMm, input.heightMm);
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1)
    throw new Error('La cantidad debe ser positiva.');
  if (input.mdf && input.material.code !== 'adhesive_vinyl')
    throw new Error('MDF sólo corresponde a vinilo adhesivo.');
  if (input.canvasStretcher && input.material.code !== 'canvas')
    throw new Error('El bastidor sólo corresponde a Canvas.');
  if (input.mdf && input.canvasStretcher)
    throw new Error('Elegí una sola terminación.');
  const find = (
    code: string,
    widthMm: number | null = null,
    heightMm: number | null = null,
  ) => {
    const row = rates.find(
      (rate) =>
        rate.priceListId === input.priceListId &&
        rate.code === code &&
        rate.widthMm === widthMm &&
        rate.heightMm === heightMm,
    );
    if (!row)
      throw new Error(`Falta configurar la tarifa ${code} para esta lista.`);
    return requireCents(row.amountCents);
  };
  const lines: QuoteLine[] = [];
  if (input.canvasStretcher) {
    lines.push({
      code: 'canvas_stretcher',
      description: `Canvas con bastidor ${input.widthMm / 10}×${input.heightMm / 10} cm`,
      amountCents: find('canvas_stretcher', input.widthMm, input.heightMm),
    });
  } else if (input.mdf) {
    // The supplied MDF tariff is the finished vinyl-on-MDF product; do not add vinyl twice.
    const code = areaMm2 <= 120_000 ? 'vinyl_mdf_small' : 'vinyl_mdf_large';
    lines.push({
      code,
      description: 'Vinilo adhesivo sobre MDF 9 mm',
      amountCents: areaPriceCents(input.widthMm, input.heightMm, find(code)),
    });
  } else {
    lines.push({
      code: input.material.code,
      description: input.material.name,
      amountCents: areaPriceCents(
        input.widthMm,
        input.heightMm,
        find(input.material.code),
      ),
    });
  }
  if (input.rods) {
    const rodCents = find('plastic_rod');
    const amountCents = Number(
      (BigInt(input.widthMm) * BigInt(input.rods) * BigInt(rodCents) + 500n) /
        1000n,
    );
    lines.push({
      code: 'plastic_rod',
      description: `${input.rods} varilla(s) plásticas`,
      amountCents,
    });
  }
  if (input.fold !== 'none') {
    const code = `banner_fold_${input.fold}_${input.widthMm <= 1000 ? 'up_to_1m' : 'over_1m'}`;
    lines.push({
      code,
      description:
        input.fold === 'top' ? 'Doblez arriba' : 'Doblez arriba y abajo',
      amountCents: find(code),
    });
  }
  const totalCents =
    lines.reduce((sum, line) => sum + line.amountCents, 0) * input.quantity;
  if (!Number.isSafeInteger(totalCents))
    throw new Error('Precio fuera de rango.');
  return {
    priceListId: input.priceListId,
    materialCode: input.material.code,
    materialName: input.material.name,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    quantity: input.quantity,
    areaMm2,
    rollFit: rollFit(input.widthMm, input.heightMm, input.material.rollWidthMm),
    notes: input.notes?.trim() || null,
    lines,
    totalCents,
  };
}

export interface LedConfiguration {
  widthMm: number;
  heightMm: number;
  panelAreaMm2: number;
  pixelsPerPanel: number;
}
export interface LedCapacity {
  totalPanels: number;
  reservations: Array<{ startsAt: string; endsAt: string; panels: number }>;
  controllers: Array<{
    id: string;
    name: string;
    maxPixels: number | null;
    isActive: boolean;
  }>;
  controllerReservations: Array<{
    controllerId: string;
    startsAt: string;
    endsAt: string;
  }>;
}
export function effectiveWindow(
  startsAt: string,
  endsAt: string,
  beforeMinutes = 0,
  afterMinutes = 0,
) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (![start, end].every(Number.isFinite) || end <= start)
    throw new Error('Intervalo inválido.');
  if (
    ![beforeMinutes, afterMinutes].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  )
    throw new Error('Buffer inválido.');
  return {
    startsAt: new Date(start - beforeMinutes * 60_000).toISOString(),
    endsAt: new Date(end + afterMinutes * 60_000).toISOString(),
  };
}
export function windowsOverlap(
  a: { startsAt: string; endsAt: string },
  b: { startsAt: string; endsAt: string },
) {
  return (
    Date.parse(a.startsAt) < Date.parse(b.endsAt) &&
    Date.parse(a.endsAt) > Date.parse(b.startsAt)
  );
}
export function ledAvailability(
  configuration: LedConfiguration,
  capacity: LedCapacity,
  window: { startsAt: string; endsAt: string },
) {
  const areaMm2 = squareMillimeters(
    configuration.widthMm,
    configuration.heightMm,
  );
  if (
    !Number.isSafeInteger(configuration.panelAreaMm2) ||
    configuration.panelAreaMm2 <= 0 ||
    areaMm2 % configuration.panelAreaMm2 !== 0
  )
    throw new Error('La medida no corresponde a paneles completos.');
  const requiredPanels = areaMm2 / configuration.panelAreaMm2;
  if (
    !Number.isSafeInteger(configuration.pixelsPerPanel) ||
    configuration.pixelsPerPanel <= 0
  )
    throw new Error('Configurá los píxeles de cada panel.');
  const requiredPixels = requiredPanels * configuration.pixelsPerPanel;
  const overlapping = capacity.reservations.filter((reservation) =>
    windowsOverlap(reservation, window),
  );
  const checkpoints = [
    window.startsAt,
    ...overlapping.map((row) => row.startsAt),
  ];
  const reservedPanels = Math.max(
    0,
    ...checkpoints.map((point) =>
      overlapping
        .filter(
          (row) =>
            Date.parse(row.startsAt) <= Date.parse(point) &&
            Date.parse(row.endsAt) > Date.parse(point),
        )
        .reduce((sum, row) => sum + row.panels, 0),
    ),
  );
  const availablePanels = capacity.totalPanels - reservedPanels;
  const controllers = capacity.controllers.filter(
    (controller) =>
      controller.isActive &&
      controller.maxPixels !== null &&
      controller.maxPixels >= requiredPixels &&
      !capacity.controllerReservations.some(
        (reservation) =>
          reservation.controllerId === controller.id &&
          windowsOverlap(reservation, window),
      ),
  );
  return {
    areaMm2,
    requiredPanels,
    requiredPixels,
    availablePanels,
    controllers,
    available: availablePanels >= requiredPanels && controllers.length > 0,
  };
}

export function quoteEventService(
  serviceName: string,
  baseCents: number,
  travelCents: number,
): { lines: QuoteLine[]; totalCents: number } {
  const lines = [
    {
      code: 'service',
      description: serviceName.trim(),
      amountCents: requireCents(baseCents),
    },
    {
      code: 'travel',
      description: 'Viáticos',
      amountCents: requireCents(travelCents),
    },
  ];
  const totalCents = lines[0].amountCents + lines[1].amountCents;
  if (!Number.isSafeInteger(totalCents))
    throw new Error('Precio fuera de rango.');
  return { lines, totalCents };
}

export type EventOfferKind =
  'fabric_screen' | 'led_screen' | 'photo_booth' | 'magic_mirror' | 'spin_360';
export interface EventOffer {
  id: string;
  businessId: string;
  kind: EventOfferKind;
  name: string;
  widthMm: number | null;
  heightMm: number | null;
  projection: 'front' | 'rear' | null;
  withProjector: boolean;
  primaryResourceId: string | null;
  projectorResourceId: string | null;
  isActive: boolean;
}
export interface EventOfferRate {
  id: string;
  businessId: string;
  offerId: string;
  priceListId: string;
  /** LED is cents/m²; every other offer is a fixed service price. */
  amountCents: number;
}
export interface LedPanelPool {
  id: string;
  businessId: string;
  totalPanels: number;
  panelAreaMm2: number;
  pixelsPerPanel: number;
  isActive: boolean;
}
export interface LedPreset {
  id: string;
  businessId: string;
  name: string;
  widthMm: number;
  heightMm: number;
  isActive: boolean;
}
export interface LedController {
  id: string;
  businessId: string;
  resourceId: string;
  maxPixels: number | null;
}
export interface LedPanelReservation {
  id: string;
  businessId: string;
  eventId: string;
  eventServiceItemId: string;
  controllerResourceId: string;
  startsAt: string;
  endsAt: string;
  panels: number;
  isActive: boolean;
}

export function eventOfferBasePrice(
  offer: EventOffer,
  rate: EventOfferRate,
): number {
  if (!offer.isActive || offer.id !== rate.offerId)
    throw new Error('Servicio no disponible.');
  if (offer.kind === 'led_screen')
    throw new Error('LED requiere las medidas de la pantalla.');
  return requireCents(rate.amountCents);
}
export function ledOfferBasePrice(
  rate: EventOfferRate,
  widthMm: number,
  heightMm: number,
): number {
  return areaPriceCents(widthMm, heightMm, rate.amountCents);
}
