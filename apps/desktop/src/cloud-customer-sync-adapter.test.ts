import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { CloudCustomerSyncAdapter } from './cloud-customer-sync-adapter';

describe('Cloud Customer pull', () => {
  it('queries only the current business after a compound timestamp/id cursor', async () => {
    let requested: URL | undefined;
    const client = createClient('http://localhost:54321', 'public-test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input) => {
          requested = new URL(
            input instanceof Request ? input.url : String(input),
          );
          return new Response('[]', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    });
    const adapter = new CloudCustomerSyncAdapter(client);
    const businessId = '11111111-1111-4111-8111-111111111111';
    const customerId = '22222222-2222-4222-8222-222222222222';
    const updatedAt = '2026-09-20T10:00:00.000001+00:00';
    expect(
      await adapter.pull(businessId, { updatedAt, id: customerId }, 25),
    ).toEqual([]);
    expect(requested?.searchParams.get('business_id')).toBe(`eq.${businessId}`);
    expect(requested?.searchParams.get('or')).toBe(
      `(updated_at.gt.${updatedAt},and(updated_at.eq.${updatedAt},id.gt.${customerId}))`,
    );
    expect(requested?.searchParams.get('limit')).toBe('25');
  });

  it('uses the known Cloud version and business in an optimistic update', async () => {
    let requested: URL | undefined;
    let method: string | undefined;
    const businessId = '11111111-1111-4111-8111-111111111111';
    const customerId = '22222222-2222-4222-8222-222222222222';
    const oldVersion = '2026-09-20T10:00:00.000001+00:00';
    const newVersion = '2026-09-20T10:00:00.000002+00:00';
    const client = createClient('http://localhost:54321', 'public-test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          requested = new URL(
            input instanceof Request ? input.url : String(input),
          );
          method = init?.method;
          return new Response(
            JSON.stringify([
              {
                id: customerId,
                business_id: businessId,
                full_name: 'Ana',
                phone: null,
                email: null,
                document_number: null,
                notes: null,
                is_active: true,
                created_at: oldVersion,
                updated_at: newVersion,
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    });
    const adapter = new CloudCustomerSyncAdapter(client);
    const result = await adapter.push({
      outboxId: 'outbox-id',
      localRevision: 1,
      cloudUpdatedAt: oldVersion,
      customer: {
        id: customerId,
        businessId,
        fullName: 'Ana',
        phone: null,
        email: null,
        documentNumber: null,
        notes: null,
        isActive: true,
        createdAt: oldVersion,
        updatedAt: oldVersion,
      },
    });
    expect(result).toMatchObject({
      kind: 'pushed',
      customer: { id: customerId, updatedAt: newVersion },
    });
    expect(method).toBe('PATCH');
    expect(requested?.searchParams.get('business_id')).toBe(`eq.${businessId}`);
    expect(requested?.searchParams.get('id')).toBe(`eq.${customerId}`);
    expect(requested?.searchParams.get('updated_at')).toBe(`eq.${oldVersion}`);
  });

  it('recognizes a previously inserted identical Customer after a lost acknowledgement', async () => {
    const businessId = '11111111-1111-4111-8111-111111111111';
    const customerId = '22222222-2222-4222-8222-222222222222';
    const createdAt = '2026-09-20T10:00:00.000001+00:00';
    const updatedAt = '2026-09-20T10:00:00.000002+00:00';
    const methods: string[] = [];
    const client = createClient('http://localhost:54321', 'public-test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (_input, init) => {
          methods.push(init?.method ?? 'GET');
          if (init?.method === 'POST')
            return new Response(
              JSON.stringify({ code: '23505', message: 'duplicate key' }),
              {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          return new Response(
            JSON.stringify({
              id: customerId,
              business_id: businessId,
              full_name: 'Ana',
              phone: null,
              email: null,
              document_number: null,
              notes: null,
              is_active: true,
              created_at: createdAt,
              updated_at: updatedAt,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    });
    const result = await new CloudCustomerSyncAdapter(client).push({
      outboxId: 'outbox-id',
      localRevision: 1,
      cloudUpdatedAt: null,
      customer: {
        id: customerId,
        businessId,
        fullName: 'Ana',
        phone: null,
        email: null,
        documentNumber: null,
        notes: null,
        isActive: true,
        createdAt,
        updatedAt: createdAt,
      },
    });
    expect(methods).toEqual(['POST', 'GET']);
    expect(result).toMatchObject({
      kind: 'pushed',
      customer: { id: customerId, updatedAt },
    });
  });
});
