import { describe, expect, it } from 'vitest';
import type {
  EventSyncCloudPort,
  EventSyncEntity,
  EventSyncLocalPort,
  EventSyncType,
  PendingEventChange,
} from './event-sync';
import { syncEventEntities } from './event-sync';
import type {
  Event,
  EventServiceItem,
  EventType,
  Resource,
  ResourceReservation,
} from '@centrocolor/domain';

const now = '2026-10-11T10:00:00.000001Z';
const later = '2026-10-11T10:00:00.000002Z';
const reservation = (id: string, updatedAt = now): ResourceReservation => ({
  id,
  businessId: 'b',
  eventId: 'e',
  resourceId: 'r',
  startsAt: '2026-11-21T22:00:00Z',
  endsAt: '2026-11-22T02:00:00Z',
  priceCents: 1000,
  notes: null,
  isActive: true,
  createdAt: now,
  updatedAt,
});
class Local implements EventSyncLocalPort {
  rows = new Map<string, EventSyncEntity>();
  changes = new Map<string, PendingEventChange>();
  conflicts = new Set<string>();
  cursorValue = null;
  add(entityType: EventSyncType, entity: EventSyncEntity) {
    this.rows.set(entity.id, entity);
    this.changes.set(entity.id, {
      outboxId: entity.id,
      entityType,
      entity,
      localRevision: 1,
      cloudUpdatedAt: null,
    });
  }
  async pending(type: EventSyncType, businessId: string) {
    return [...this.changes.values()].filter(
      (c) =>
        c.entityType === type &&
        c.entity.businessId === businessId &&
        !this.conflicts.has(c.entity.id),
    );
  }
  async pendingFor(type: EventSyncType, _businessId: string, id: string) {
    const c = this.changes.get(id);
    return c?.entityType === type ? c : null;
  }
  async acknowledge(change: PendingEventChange, cloud: EventSyncEntity) {
    this.rows.set(cloud.id, cloud);
    this.changes.delete(change.entity.id);
  }
  async fail() {}
  async conflict(change: PendingEventChange) {
    this.conflicts.add(change.entity.id);
  }
  async availabilityConflict(change: PendingEventChange) {
    this.conflicts.add(change.entity.id);
  }
  async applyRemote(_type: EventSyncType, entity: EventSyncEntity) {
    this.rows.set(entity.id, entity);
    return true;
  }
  async cursor() {
    return this.cursorValue;
  }
  async advanceCursor() {}
}

describe('event sync', () => {
  it('is idempotent and pull does not create outbox work', async () => {
    const local = new Local();
    local.add('resource_reservation', reservation('local'));
    const cloud: EventSyncCloudPort = {
      push: async (_type, change) => ({
        kind: 'pushed',
        entity: { ...change.entity, updatedAt: later },
      }),
      pull: async () => [reservation('remote', later)],
    };
    await syncEventEntities('resource_reservation', 'b', local, cloud);
    expect(local.changes.size).toBe(0);
    expect(local.rows.has('remote')).toBe(true);
  });
  it('marks an offline reservation conflict instead of accepting a double booking', async () => {
    const local = new Local();
    local.add('resource_reservation', reservation('offline'));
    const remote = { ...reservation('web', later), eventId: 'web-event' };
    const cloud: EventSyncCloudPort = {
      push: async (_type, change) => ({
        kind: 'availability_conflict',
        entity: change.entity,
        conflictingReservation: remote,
      }),
      pull: async () => [],
    };
    const result = await syncEventEntities(
      'resource_reservation',
      'b',
      local,
      cloud,
    );
    expect(result.conflicts).toBe(1);
    expect(local.conflicts.has('offline')).toBe(true);
    expect(local.changes.has('offline')).toBe(true);
  });

  it('syncs EventType, Resource, Event and ServiceItem with stable UUIDs', async () => {
    const local = new Local();
    const entities: [EventSyncType, EventSyncEntity][] = [
      [
        'event_type',
        {
          id: 'type',
          businessId: 'b',
          name: 'Alquiler',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        } satisfies EventType,
      ],
      [
        'resource',
        {
          id: 'resource',
          businessId: 'b',
          name: 'Pantalla',
          description: null,
          defaultPriceCents: 1000,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        } satisfies Resource,
      ],
      [
        'event',
        {
          id: 'event',
          businessId: 'b',
          branchId: 'branch',
          customerId: 'customer',
          eventTypeId: 'type',
          title: 'Alquiler',
          startsAt: '2026-11-21T19:00:00Z',
          endsAt: '2026-11-22T02:00:00Z',
          venueName: null,
          venueAddress: null,
          status: 'inquiry',
          notes: null,
          createdBy: 'user',
          createdAt: now,
          updatedAt: now,
        } satisfies Event,
      ],
      [
        'event_service_item',
        {
          id: 'service',
          businessId: 'b',
          eventId: 'event',
          sourceServiceId: null,
          name: 'Fotografía',
          description: null,
          quantity: 1,
          unitPriceCents: 1000,
          totalCents: 1000,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        } satisfies EventServiceItem,
      ],
    ];
    for (const [type, entity] of entities) {
      local.add(type, entity);
      const cloud: EventSyncCloudPort = {
        push: async (_type, change) => ({
          kind: 'pushed',
          entity: { ...change.entity, updatedAt: later },
        }),
        pull: async () => [],
      };
      await syncEventEntities(type, 'b', local, cloud);
      expect(local.rows.get(entity.id)?.id).toBe(entity.id);
      expect(local.changes.has(entity.id)).toBe(false);
      await syncEventEntities(type, 'b', local, cloud);
      expect(local.changes.has(entity.id)).toBe(false);
    }
  });
});
