import { describe, expect, it } from 'vitest';
import {
  calculateFrameQuote,
  centimetersToMillimeters,
  materialAreaMm2,
  mouldingLengthMm,
  markupPrice,
} from './framing';

describe('framing calculation', () => {
  it('uses integer millimetres and opening plus face width for cut length', () => {
    expect(centimetersToMillimeters('40')).toBe(400);
    expect(centimetersToMillimeters('40.5')).toBe(405);
    expect(mouldingLengthMm(400, 600, 35, 0)).toBe(2140);
    expect(mouldingLengthMm(400, 600, 35, 10)).toBe(2354);
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
    expect(result.mouldingPriceCents).toBe(2568);
    expect(result.materials[0]?.priceCents).toBe(1440);
    expect(result.totalCents).toBe(5008);
  });
});
