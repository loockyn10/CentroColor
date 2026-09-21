import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Product } from '@centrocolor/domain';
import { CloudPosSyncAdapter } from './cloud-pos-sync-adapter';

const businessId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const t1 = '2026-09-20T10:00:00.000001+00:00';
const t2 = '2026-09-20T10:00:00.000002+00:00';
const product: Product = {
  id: productId,
  businessId,
  name: 'Álbum',
  barcode: 'X',
  salePriceCents: 1000,
  costPriceCents: null,
  categoryId: null,
  isActive: true,
  tracksInventory: false,
  createdAt: t1,
  updatedAt: t1,
};
const row = (name: string) => ({
  id: productId,
  business_id: businessId,
  name,
  barcode: 'X',
  sale_price_cents: 1000,
  cost_price_cents: null,
  category_id: null,
  is_active: true,
  tracks_inventory: false,
  created_at: t1,
  updated_at: t2,
});

describe('Cloud Product sync adapter', () => {
  it('uses the known version and business for optimistic Product edits', async () => {
    let request: URL | undefined;
    let body: Record<string, unknown> | undefined;
    const client = createClient('http://localhost:54321', 'public-test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          request = new URL(
            input instanceof Request ? input.url : String(input),
          );
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(
            JSON.stringify([{ ...row('Álbum'), tracks_inventory: true }]),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        },
      },
    });
    const result = await new CloudPosSyncAdapter(client).push('product', {
      outboxId: 'o',
      entityType: 'product',
      entity: { ...product, tracksInventory: true },
      localRevision: 1,
      cloudUpdatedAt: t1,
    });
    expect(result.kind).toBe('pushed');
    expect(request?.searchParams.get('business_id')).toBe(`eq.${businessId}`);
    expect(request?.searchParams.get('updated_at')).toBe(`eq.${t1}`);
    expect(body?.tracks_inventory).toBe(true);
    expect((result.entity as Product).tracksInventory).toBe(true);
  });

  it('retains a divergent Cloud Product as an explicit conflict', async () => {
    const client = createClient('http://localhost:54321', 'public-test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (_input, init) =>
          new Response(
            init?.method === 'PATCH'
              ? '[]'
              : JSON.stringify(row('Otro nombre')),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      },
    });
    const result = await new CloudPosSyncAdapter(client).push('product', {
      outboxId: 'o',
      entityType: 'product',
      entity: product,
      localRevision: 1,
      cloudUpdatedAt: t1,
    });
    expect(result).toMatchObject({
      kind: 'conflict',
      entity: { id: productId, name: 'Otro nombre' },
    });
  });
});
