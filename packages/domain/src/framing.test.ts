import { describe, expect, it } from 'vitest';
import {
  calculateFrameQuote,
  centimetersToMillimeters,
  materialAreaMm2,
  mouldingLengthMm,
  markupPrice,
} from './framing';

describe('framing calculation', () => {
  it('uses integer millimetres and the opening perimeter for cut length', () => {
    expect(centimetersToMillimeters('40')).toBe(400);
    expect(centimetersToMillimeters('40.5')).toBe(405);
    expect(mouldingLengthMm(400, 600, 0)).toBe(2000);
    expect(mouldingLengthMm(400, 600, 10)).toBe(2200);
  });
  it('30 x 40 cm consumes 140 cm of moulding and 0.12 m² of glass/back', () => {
    expect(mouldingLengthMm(300, 400, 0)).toBe(1400);
    expect(materialAreaMm2(300, 400, 0) / 1_000_000).toBeCloseTo(0.12);
  });
  it('never adds the moulding face width to the consumption', () => {
    const quote = (faceWidthMm: number | null) =>
      calculateFrameQuote({
        widthMm: 300,
        heightMm: 400,
        moulding: {
          id: 'm',
          name: 'Negra',
          faceWidthMm,
          costPerMeterCents: 1000,
          salePricePerMeterCents: null,
          wastePercent: 0,
        },
        materials: [],
        settings: {
          businessId: 'b',
          defaultMarkupPercent: 0,
          defaultLabourCents: 0,
          defaultMouldingWastePercent: 0,
          defaultMaterialWastePercent: 0,
          updatedAt: 'x',
        },
      });
    expect(quote(null).mouldingLengthMm).toBe(1400);
    expect(quote(35).mouldingLengthMm).toBe(1400);
    expect(quote(90).mouldingLengthMm).toBe(1400);
  });
  it('uses exact mm² and rounds monetary price only in cents', () => {
    expect(materialAreaMm2(400, 600, 0)).toBe(240000);
    expect(markupPrice(10_000, 25)).toBe(12_500);
    const result = calculateFrameQuote({
      widthMm: 400,
      heightMm: 600,
      moulding: {
        id: 'm',
        name: 'Negra',
        faceWidthMm: 35,
        costPerMeterCents: 1000,
        salePricePerMeterCents: null,
        wastePercent: 0,
      },
      materials: [
        {
          material: {
            id: 'g',
            name: 'Vidrio',
            pricingUnit: 'square_meter',
            costCents: 5000,
            salePriceCents: null,
            wastePercent: 0,
          },
        },
      ],
      settings: {
        businessId: 'b',
        defaultMarkupPercent: 20,
        defaultLabourCents: 1000,
        defaultMouldingWastePercent: 0,
        defaultMaterialWastePercent: 0,
        updatedAt: 'x',
      },
    });
    expect(result.mouldingPriceCents).toBe(2400);
    expect(result.materials[0]?.priceCents).toBe(1440);
    expect(result.totalCents).toBe(4840);
  });
});
