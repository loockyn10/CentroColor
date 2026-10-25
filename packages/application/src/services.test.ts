import { describe, expect, it } from 'vitest';
import { effectivePriceListId, type PriceList } from '@centrocolor/domain';
import { buildPhotoJob } from './photo';

const now = '2026-10-24T12:00:00Z';
const lists: PriceList[] = [
  {
    id: 'public',
    businessId: 'b',
    name: 'Público',
    kind: 'public',
    isDefault: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'pro',
    businessId: 'b',
    name: 'Profesional',
    kind: 'professional',
    isDefault: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
];

describe('SERVICIOS-01 precios en trabajos', () => {
  it('usa lista pública sin asignación y profesional sólo si el cliente la tiene', () => {
    expect(effectivePriceListId({ priceListId: null }, lists)).toBe('public');
    expect(effectivePriceListId({ priceListId: 'pro' }, lists)).toBe('pro');
    expect(effectivePriceListId({ priceListId: 'pro' }, lists, true)).toBe(
      'public',
    );
  });
  it('PhotoJob conserva variante, lista y precio histórico en su ítem', () => {
    const created = buildPhotoJob(
      {
        businessId: 'b',
        branchId: 'branch',
        customerId: 'customer',
        createdBy: 'owner',
        promisedAt: null,
        notes: null,
        items: [
          {
            photoServiceId: 'size',
            labVariantId: 'matte',
            priceListId: 'pro',
            serviceNameSnapshot: '10×15 · Mate · Profesional',
            quantity: 10,
            unitPriceCents: 40000,
            notes: null,
            widthMm: 100,
            heightMm: 150,
          },
        ],
      },
      now,
    );
    expect(created.items[0]).toMatchObject({
      labVariantId: 'matte',
      priceListId: 'pro',
      quantity: 10,
      unitPriceCents: 40000,
      totalCents: 400000,
      serviceNameSnapshot: '10×15 · Mate · Profesional',
    });
    lists[1]!.name = 'Profesional actualizada';
    expect(created.items[0]!.serviceNameSnapshot).toBe(
      '10×15 · Mate · Profesional',
    );
  });
});
