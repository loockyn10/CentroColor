/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory port double. */
import { describe, expect, it } from 'vitest';
import { syncFramingEntities } from './framing-sync';

const entity = (updatedAt: string) => ({
  id: 'm1',
  businessId: 'b1',
  code: null,
  name: 'Varilla',
  description: null,
  faceWidthMm: 35,
  costPerMeterCents: 100,
  salePricePerMeterCents: null,
  wastePercent: 0,
  isActive: true,
  createdAt: updatedAt,
  updatedAt,
});
describe('framing sync', () => {
  it('acknowledges a retry-safe push then pulls without a local loop', async () => {
    const calls: string[] = [];
    const local: any = {
      pending: async () => [
        {
          outboxId: 'o',
          entityType: 'moulding',
          entity: entity('2026-01-01T00:00:00Z'),
          localRevision: 1,
          cloudUpdatedAt: null,
        },
      ],
      pendingFor: async () => null,
      acknowledge: async () => calls.push('ack'),
      fail: async () => {},
      conflict: async () => {},
      applyRemote: async () => {
        calls.push('pull');
        return true;
      },
      cursor: async () => null,
      advanceCursor: async () => calls.push('cursor'),
    };
    const cloud: any = {
      push: async () => ({
        kind: 'pushed',
        entity: entity('2026-01-02T00:00:00Z'),
      }),
      pull: async () => [entity('2026-01-03T00:00:00Z')],
    };
    expect(await syncFramingEntities('moulding', 'b1', local, cloud)).toEqual({
      pushed: 1,
      pulled: 1,
      conflicts: 0,
    });
    expect(calls).toEqual(['ack', 'pull', 'cursor']);
  });
});
