import {
  calculateFrameQuote,
  normalizeMaterialDetails,
  normalizeMouldingDetails,
  type FrameJob,
  type FrameJobStatus,
  type FrameMaterial,
  type FrameMoulding,
  type FrameQuote,
  type FrameQuoteItem,
  type FrameQuoteStatus,
  type FramingSettings,
} from '@centrocolor/domain';

export interface FramingRepository {
  listMouldings(
    businessId: string,
    includeInactive?: boolean,
  ): Promise<FrameMoulding[]>;
  createMoulding(value: FrameMoulding): Promise<FrameMoulding>;
  updateMoulding(
    businessId: string,
    id: string,
    value: Omit<
      FrameMoulding,
      'id' | 'businessId' | 'isActive' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<FrameMoulding>;
  setMouldingActive(
    businessId: string,
    id: string,
    active: boolean,
  ): Promise<FrameMoulding>;
  listMaterials(
    businessId: string,
    includeInactive?: boolean,
  ): Promise<FrameMaterial[]>;
  createMaterial(value: FrameMaterial): Promise<FrameMaterial>;
  updateMaterial(
    businessId: string,
    id: string,
    value: Omit<
      FrameMaterial,
      'id' | 'businessId' | 'isActive' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<FrameMaterial>;
  setMaterialActive(
    businessId: string,
    id: string,
    active: boolean,
  ): Promise<FrameMaterial>;
  getSettings(businessId: string): Promise<FramingSettings>;
  saveSettings(value: FramingSettings): Promise<FramingSettings>;
  listQuotes(
    businessId: string,
    branchId: string,
    statuses?: FrameQuoteStatus[],
  ): Promise<FrameQuote[]>;
  getQuote(
    businessId: string,
    id: string,
  ): Promise<{ quote: FrameQuote; items: FrameQuoteItem[] } | null>;
  saveQuote(quote: FrameQuote, items: FrameQuoteItem[]): Promise<FrameQuote>;
  setQuoteStatus(
    businessId: string,
    id: string,
    status: FrameQuoteStatus,
  ): Promise<FrameQuote>;
  listJobs(
    businessId: string,
    branchId: string,
    statuses?: FrameJobStatus[],
  ): Promise<FrameJob[]>;
  createJob(job: FrameJob): Promise<FrameJob>;
  setJobStatus(
    businessId: string,
    id: string,
    status: FrameJobStatus,
  ): Promise<FrameJob>;
  countOpenJobs(businessId: string, branchId: string): Promise<number>;
}
export function createMoulding(
  repository: FramingRepository,
  businessId: string,
  details: Omit<
    FrameMoulding,
    'id' | 'businessId' | 'isActive' | 'createdAt' | 'updatedAt'
  >,
  now = new Date().toISOString(),
) {
  return repository.createMoulding({
    id: crypto.randomUUID(),
    businessId,
    ...normalizeMouldingDetails(details),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}
export function createMaterial(
  repository: FramingRepository,
  businessId: string,
  details: Omit<
    FrameMaterial,
    'id' | 'businessId' | 'isActive' | 'createdAt' | 'updatedAt'
  >,
  now = new Date().toISOString(),
) {
  return repository.createMaterial({
    id: crypto.randomUUID(),
    businessId,
    ...normalizeMaterialDetails(details),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}
export function newQuote(
  input: {
    businessId: string;
    branchId: string;
    customerId: string | null;
    createdBy: string;
    widthMm: number;
    heightMm: number;
    notes: string | null;
    moulding: FrameMoulding;
    materials: FrameMaterial[];
    settings: FramingSettings;
  },
  now = new Date().toISOString(),
) {
  const calculation = calculateFrameQuote({
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    moulding: input.moulding,
    materials: input.materials.map((material) => ({ material })),
    settings: input.settings,
  });
  const quote: FrameQuote = {
    id: crypto.randomUUID(),
    businessId: input.businessId,
    branchId: input.branchId,
    customerId: input.customerId,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    measurementMode: 'opening',
    status: 'draft',
    notes: input.notes,
    subtotalCents: calculation.subtotalCents,
    totalCents: calculation.totalCents,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  const items: FrameQuoteItem[] = [
    {
      id: crypto.randomUUID(),
      businessId: input.businessId,
      quoteId: quote.id,
      itemType: 'moulding',
      sourceId: input.moulding.id,
      nameSnapshot: input.moulding.name,
      quantityNumerator: calculation.mouldingLengthMm,
      quantityDenominator: 1000,
      unit: 'linear_meter',
      unitPriceCents: Math.ceil(
        (calculation.mouldingPriceCents * 1000) / calculation.mouldingLengthMm,
      ),
      totalCents: calculation.mouldingPriceCents,
      metadata: {
        measurementMode: 'opening',
        faceWidthMm: input.moulding.faceWidthMm,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: crypto.randomUUID(),
      businessId: input.businessId,
      quoteId: quote.id,
      itemType: 'labour',
      sourceId: null,
      nameSnapshot: 'Mano de obra',
      quantityNumerator: 1,
      quantityDenominator: 1,
      unit: 'labour',
      unitPriceCents: calculation.labourCents,
      totalCents: calculation.labourCents,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    },
    ...calculation.materials.map((x) => ({
      id: crypto.randomUUID(),
      businessId: input.businessId,
      quoteId: quote.id,
      itemType: 'material' as const,
      sourceId: x.sourceId,
      nameSnapshot: x.name,
      quantityNumerator: x.quantityNumerator,
      quantityDenominator: x.quantityDenominator,
      unit: x.unit,
      unitPriceCents: Math.ceil(
        (x.priceCents * x.quantityDenominator) / x.quantityNumerator,
      ),
      totalCents: x.priceCents,
      metadata: { measurementMode: 'opening' },
      createdAt: now,
      updatedAt: now,
    })),
  ];
  return { quote, items, calculation };
}
