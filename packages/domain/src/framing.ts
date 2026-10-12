import { requireCents } from './product';

export const frameMaterialTypes = [
  'glass',
  'backing',
  'passepartout',
  'print',
  'other',
] as const;
export type FrameMaterialType = (typeof frameMaterialTypes)[number];
export const framePricingUnits = [
  'square_meter',
  'linear_meter',
  'unit',
] as const;
export type FramePricingUnit = (typeof framePricingUnits)[number];
export const frameQuoteStatuses = [
  'draft',
  'quoted',
  'accepted',
  'rejected',
  'expired',
] as const;
export type FrameQuoteStatus = (typeof frameQuoteStatuses)[number];
export const frameJobStatuses = [
  'pending',
  'in_progress',
  'ready',
  'delivered',
  'cancelled',
] as const;
export type FrameJobStatus = (typeof frameJobStatuses)[number];
export const frameMeasurementModes = ['opening'] as const;
export type FrameMeasurementMode = (typeof frameMeasurementModes)[number];

export interface FrameMoulding {
  id: string;
  businessId: string;
  code: string | null;
  name: string;
  description: string | null;
  faceWidthMm: number | null;
  costPerMeterCents: number;
  salePricePerMeterCents: number | null;
  wastePercent: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface FrameMaterial {
  id: string;
  businessId: string;
  name: string;
  materialType: FrameMaterialType;
  pricingUnit: FramePricingUnit;
  costCents: number;
  salePriceCents: number | null;
  wastePercent: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface FramingSettings {
  businessId: string;
  defaultMarkupPercent: number;
  defaultLabourCents: number;
  defaultMouldingWastePercent: number;
  defaultMaterialWastePercent: number;
  updatedAt: string;
}
export interface FrameQuote {
  id: string;
  businessId: string;
  branchId: string;
  customerId: string | null;
  widthMm: number;
  heightMm: number;
  measurementMode: FrameMeasurementMode;
  status: FrameQuoteStatus;
  notes: string | null;
  subtotalCents: number;
  totalCents: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export type FrameQuoteItemType = 'moulding' | 'material' | 'labour';
export interface FrameQuoteItem {
  id: string;
  businessId: string;
  quoteId: string;
  itemType: FrameQuoteItemType;
  sourceId: string | null;
  nameSnapshot: string;
  quantityNumerator: number;
  quantityDenominator: number;
  unit: FramePricingUnit | 'labour';
  unitPriceCents: number;
  totalCents: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface FrameJob {
  id: string;
  businessId: string;
  branchId: string;
  quoteId: string;
  customerId: string | null;
  status: FrameJobStatus;
  promisedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FrameCalculationMaterial {
  material: Pick<
    FrameMaterial,
    | 'id'
    | 'name'
    | 'pricingUnit'
    | 'costCents'
    | 'salePriceCents'
    | 'wastePercent'
  >;
  quantity?: number;
}
export interface FrameCalculation {
  mouldingLengthMm: number;
  mouldingPriceCents: number;
  materials: Array<{
    sourceId: string;
    name: string;
    unit: FramePricingUnit;
    quantityNumerator: number;
    quantityDenominator: number;
    priceCents: number;
  }>;
  labourCents: number;
  subtotalCents: number;
  totalCents: number;
}

const clean = (v: string, message: string) => {
  const value = v.trim().replace(/\s+/g, ' ');
  if (!value) throw new Error(message);
  return value;
};
export function requireMillimeters(value: number) {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error('Las medidas deben ser milímetros enteros positivos.');
  return value;
}
export function centimetersToMillimeters(value: string | number) {
  const normalized = String(value).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,1})?$/.test(normalized))
    throw new Error('Ingresá centímetros con un decimal como máximo.');
  const tenths = Math.round(Number(normalized) * 10);
  return requireMillimeters(tenths);
}
export function requirePercent(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 1000)
    throw new Error('El porcentaje debe ser un entero entre 0 y 1000.');
  return value;
}
export function applyWaste(value: number, percent: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Cantidad inválida.');
  return Math.ceil((value * (100 + requirePercent(percent))) / 100);
}
export function markupPrice(costCents: number, markupPercent: number) {
  const cost = requireCents(costCents);
  return Math.ceil((cost * (100 + requirePercent(markupPercent))) / 100);
}
/** Opening is the internal useful dimension. Cut length is 2 * ((width + face width) + (height + face width)); face width may be zero until configured. */
export function mouldingLengthMm(
  widthMm: number,
  heightMm: number,
  faceWidthMm: number | null,
  wastePercent: number,
) {
  const w = requireMillimeters(widthMm),
    h = requireMillimeters(heightMm);
  const face = faceWidthMm === null ? 0 : requireMillimeters(faceWidthMm);
  return applyWaste(2 * (w + h + 2 * face), wastePercent);
}
export function materialAreaMm2(
  widthMm: number,
  heightMm: number,
  wastePercent: number,
) {
  return applyWaste(
    requireMillimeters(widthMm) * requireMillimeters(heightMm),
    wastePercent,
  );
}
export function calculateFrameQuote(input: {
  widthMm: number;
  heightMm: number;
  moulding: Pick<
    FrameMoulding,
    | 'id'
    | 'name'
    | 'faceWidthMm'
    | 'costPerMeterCents'
    | 'salePricePerMeterCents'
    | 'wastePercent'
  >;
  materials: FrameCalculationMaterial[];
  settings: FramingSettings;
}): FrameCalculation {
  const mouldingLength = mouldingLengthMm(
    input.widthMm,
    input.heightMm,
    input.moulding.faceWidthMm,
    input.moulding.wastePercent ?? input.settings.defaultMouldingWastePercent,
  );
  const mouldingMeterPrice =
    input.moulding.salePricePerMeterCents ??
    markupPrice(
      input.moulding.costPerMeterCents,
      input.settings.defaultMarkupPercent,
    );
  const mouldingPrice = Math.ceil((mouldingLength * mouldingMeterPrice) / 1000);
  const materials = input.materials.map(({ material, quantity }) => {
    const raw =
      material.pricingUnit === 'square_meter'
        ? materialAreaMm2(
            input.widthMm,
            input.heightMm,
            material.wastePercent ?? input.settings.defaultMaterialWastePercent,
          )
        : material.pricingUnit === 'linear_meter'
          ? mouldingLength
          : Math.max(1, Math.trunc(quantity ?? 1));
    const denominator =
      material.pricingUnit === 'square_meter'
        ? 1_000_000
        : material.pricingUnit === 'linear_meter'
          ? 1000
          : 1;
    const unitPrice =
      material.salePriceCents ??
      markupPrice(material.costCents, input.settings.defaultMarkupPercent);
    return {
      sourceId: material.id,
      name: material.name,
      unit: material.pricingUnit,
      quantityNumerator: raw,
      quantityDenominator: denominator,
      priceCents: Math.ceil((raw * unitPrice) / denominator),
    };
  });
  const labour = requireCents(input.settings.defaultLabourCents);
  const subtotal =
    mouldingPrice + materials.reduce((s, x) => s + x.priceCents, 0) + labour;
  if (!Number.isSafeInteger(subtotal))
    throw new Error('El total está fuera de rango.');
  return {
    mouldingLengthMm: mouldingLength,
    mouldingPriceCents: mouldingPrice,
    materials,
    labourCents: labour,
    subtotalCents: subtotal,
    totalCents: subtotal,
  };
}
export function normalizeMouldingDetails(
  x: Omit<
    FrameMoulding,
    'id' | 'businessId' | 'isActive' | 'createdAt' | 'updatedAt'
  >,
) {
  return {
    ...x,
    code: x.code?.trim() || null,
    name: clean(x.name, 'El nombre de la varilla es obligatorio.'),
    description: x.description?.trim() || null,
    faceWidthMm:
      x.faceWidthMm === null ? null : requireMillimeters(x.faceWidthMm),
    costPerMeterCents: requireCents(x.costPerMeterCents),
    salePricePerMeterCents:
      x.salePricePerMeterCents === null
        ? null
        : requireCents(x.salePricePerMeterCents),
    wastePercent:
      x.wastePercent === null ? null : requirePercent(x.wastePercent),
  };
}
export function normalizeMaterialDetails(
  x: Omit<
    FrameMaterial,
    'id' | 'businessId' | 'isActive' | 'createdAt' | 'updatedAt'
  >,
) {
  if (
    !(frameMaterialTypes as readonly string[]).includes(x.materialType) ||
    !(framePricingUnits as readonly string[]).includes(x.pricingUnit)
  )
    throw new Error('Tipo o unidad de material inválido.');
  return {
    ...x,
    name: clean(x.name, 'El nombre del material es obligatorio.'),
    costCents: requireCents(x.costCents),
    salePriceCents:
      x.salePriceCents === null ? null : requireCents(x.salePriceCents),
    wastePercent:
      x.wastePercent === null ? null : requirePercent(x.wastePercent),
  };
}
