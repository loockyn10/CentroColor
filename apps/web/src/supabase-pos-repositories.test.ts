import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Product, Sale, SaleItem } from '@centrocolor/domain';
import {
  SupabaseProductRepository,
  SupabaseSaleRepository,
} from './supabase-pos-repositories';

const product: Product = {
  id: 'p',
  businessId: 'b',
  name: 'Álbum',
  barcode: 'X',
  salePriceCents: 1250,
  costPriceCents: 800,
  categoryId: null,
  isActive: true,
  tracksInventory: false,
  createdAt: '2026-09-20T10:00:00Z',
  updatedAt: '2026-09-20T10:00:00Z',
};
const productRow = {
  id: 'p',
  business_id: 'b',
  name: 'Álbum',
  barcode: 'X',
  sale_price_cents: 1250,
  cost_price_cents: 800,
  category_id: null,
  is_active: true,
  tracks_inventory: false,
  created_at: product.createdAt,
  updated_at: product.updatedAt,
};
const sale: Sale = {
  id: 's',
  businessId: 'b',
  branchId: 'branch',
  deviceId: null,
  createdBy: 'user',
  status: 'completed',
  subtotalCents: 1250,
  totalCents: 1250,
  paymentMethod: 'cash',
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
};
const item: SaleItem = {
  id: 'i',
  saleId: 's',
  productId: 'p',
  productName: 'Álbum',
  barcode: 'X',
  unitPriceCents: 1250,
  quantity: 1,
  totalCents: 1250,
  lineTotalCents: 1250,
  tracksInventory: false,
};
const saleRow = {
  id: 's',
  business_id: 'b',
  branch_id: 'branch',
  device_id: null,
  created_by: 'user',
  status: 'completed',
  subtotal_cents: 1250,
  total_cents: 1250,
  payment_method: 'cash',
  created_at: sale.createdAt,
  updated_at: sale.updatedAt,
};
const itemRow = {
  id: 'i',
  business_id: 'b',
  sale_id: 's',
  product_id: 'p',
  product_name: 'Álbum',
  barcode: 'X',
  unit_price_cents: 1250,
  quantity: 1,
  total_cents: 1250,
  tracks_inventory: false,
};

function query(data: unknown) {
  const chain = {
    insert: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
    single: vi.fn(async () => ({ data, error: null })),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  for (const method of [
    'insert',
    'select',
    'eq',
    'order',
    'limit',
    'range',
  ] as const)
    chain[method].mockReturnValue(chain);
  return chain;
}

describe('Web POS Cloud repositories', () => {
  it('creates and lists products under the selected business', async () => {
    const insert = query(productRow);
    const list = query([productRow]);
    const from = vi.fn().mockReturnValueOnce(insert).mockReturnValueOnce(list);
    const repository = new SupabaseProductRepository({
      from,
    } as unknown as SupabaseClient);
    expect(await repository.create(product)).toEqual(product);
    expect(await repository.list('b', '', 20)).toEqual([product]);
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p', business_id: 'b' }),
    );
    expect(list.eq).toHaveBeenCalledWith('business_id', 'b');
  });

  it('sends checkout as one RPC and loads history with item snapshots', async () => {
    const rpc = vi.fn(async () => ({ data: saleRow, error: null }));
    const list = query([saleRow]);
    const get = query(saleRow);
    const items = query([itemRow]);
    const from = vi
      .fn()
      .mockReturnValueOnce(list)
      .mockReturnValueOnce(get)
      .mockReturnValueOnce(items);
    const repository = new SupabaseSaleRepository({
      rpc,
      from,
    } as unknown as SupabaseClient);
    await repository.complete(sale, [item]);
    expect(rpc).toHaveBeenCalledWith(
      'complete_pos_sale',
      expect.objectContaining({
        p_sale: expect.objectContaining({ id: 's', business_id: 'b' }),
        p_items: [expect.objectContaining({ id: 'i', product_name: 'Álbum' })],
      }),
    );
    expect(await repository.list('b', 20)).toEqual([sale]);
    expect(await repository.get('b', 's')).toEqual({ sale, items: [item] });
    expect(items.eq).toHaveBeenCalledWith('sale_id', 's');
  });
});
