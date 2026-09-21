import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { CloudStockSyncAdapter } from './cloud-stock-sync-adapter';

const row = {
  id: '22222222-2222-4222-8222-222222222222',
  business_id: '11111111-1111-4111-8111-111111111111',
  branch_id: '33333333-3333-4333-8333-333333333333',
  product_id: '44444444-4444-4444-8444-444444444444',
  movement_type: 'entry',
  quantity_delta: 4,
  sale_id: null,
  sale_item_id: null,
  note: 'Reposición',
  created_by: '55555555-5555-4555-8555-555555555555',
  device_id: null,
  occurred_at: '2026-09-21T10:00:00Z',
  received_at: '2026-09-21T12:00:00.000001Z',
};

describe('Cloud StockMovement sync adapter', () => {
  it('pushes the stable UUID and pulls by server receipt cursor', async () => {
    const requests: { url: URL; body: Record<string, unknown> | null }[] = [];
    const client = createClient('http://localhost:54321', 'public-test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          requests.push({
            url,
            body: init?.body
              ? (JSON.parse(String(init.body)) as Record<string, unknown>)
              : null,
          });
          return new Response(
            JSON.stringify(url.pathname.includes('/rpc/') ? row : [row]),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        },
      },
    });
    const adapter = new CloudStockSyncAdapter(client);
    const local = {
      id: row.id,
      businessId: row.business_id,
      branchId: row.branch_id,
      productId: row.product_id,
      movementType: 'entry' as const,
      quantityDelta: 4,
      saleId: null,
      saleItemId: null,
      note: row.note,
      createdBy: row.created_by,
      deviceId: null,
      occurredAt: row.occurred_at,
      receivedAt: null,
    };
    const pushed = await adapter.push(local);
    expect(pushed.id).toBe(local.id);
    expect(requests[0].body).toMatchObject({
      p_movement: { id: local.id, quantity_delta: 4 },
    });
    const pulled = await adapter.pull(
      row.business_id,
      { receivedAt: row.received_at, id: row.id },
      100,
    );
    expect(pulled[0].receivedAt).toBe(row.received_at);
    expect(requests[1].url.searchParams.get('or')).toContain('received_at.gt.');
  });
});
