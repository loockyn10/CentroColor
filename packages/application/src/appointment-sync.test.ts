import { describe, expect, it } from 'vitest';
import type { Appointment, AppointmentType } from '@centrocolor/domain';
import {
  syncAppointments,
  type AppointmentSyncCloudPort,
  type AppointmentSyncCursor,
  type AppointmentSyncEntity,
  type AppointmentSyncLocalPort,
  type AppointmentSyncType,
  type PendingAppointmentChange,
} from './appointment-sync';

const t1 = '2026-10-11T10:00:00.000001+00:00';
const t2 = '2026-10-11T10:00:00.000002+00:00';
const type = (id: string, updatedAt = t1): AppointmentType => ({
  id,
  businessId: 'b',
  name: 'Foto carnet',
  defaultDurationMinutes: 15,
  isActive: true,
  createdAt: t1,
  updatedAt,
});
const appointment = (id: string, updatedAt = t1): Appointment => ({
  id,
  businessId: 'b',
  branchId: 'branch',
  customerId: 'customer',
  appointmentTypeId: 'type',
  title: 'Foto carnet',
  startsAt: '2026-10-11T13:00:00.000Z',
  endsAt: '2026-10-11T13:15:00.000Z',
  status: 'scheduled',
  notes: null,
  createdBy: 'user',
  createdAt: t1,
  updatedAt,
});

class MemoryLocal implements AppointmentSyncLocalPort {
  rows = new Map<string, AppointmentSyncEntity>();
  changes = new Map<string, PendingAppointmentChange>();
  cursors = new Map<AppointmentSyncType, AppointmentSyncCursor>();
  conflicts = new Set<string>();
  add(entityType: AppointmentSyncType, entity: AppointmentSyncEntity) {
    this.rows.set(entity.id, entity);
    this.changes.set(entity.id, {
      outboxId: entity.id,
      entityType,
      entity,
      localRevision: 1,
      cloudUpdatedAt: null,
    });
  }
  async pending(type: AppointmentSyncType, businessId: string, limit: number) {
    return [...this.changes.values()]
      .filter(
        (change) =>
          change.entityType === type &&
          change.entity.businessId === businessId &&
          !this.conflicts.has(change.entity.id),
      )
      .slice(0, limit);
  }
  async pendingFor(type: AppointmentSyncType, _businessId: string, id: string) {
    const change = this.changes.get(id);
    return change?.entityType === type ? change : null;
  }
  async acknowledge(
    change: PendingAppointmentChange,
    cloud: AppointmentSyncEntity,
  ) {
    this.rows.set(cloud.id, cloud);
    this.changes.delete(change.entity.id);
  }
  async fail() {}
  async conflict(change: PendingAppointmentChange) {
    this.conflicts.add(change.entity.id);
  }
  async applyRemote(_type: AppointmentSyncType, entity: AppointmentSyncEntity) {
    this.rows.set(entity.id, entity);
    return true;
  }
  async cursor(type: AppointmentSyncType) {
    return this.cursors.get(type) ?? null;
  }
  async advanceCursor(
    type: AppointmentSyncType,
    _businessId: string,
    cursor: AppointmentSyncCursor,
  ) {
    this.cursors.set(type, cursor);
  }
}
const cloud = (
  overrides: Partial<AppointmentSyncCloudPort> = {},
): AppointmentSyncCloudPort => ({
  push: async (_type, change) => ({
    kind: 'pushed',
    entity: { ...change.entity, updatedAt: t2 },
  }),
  pull: async () => [],
  ...overrides,
});

describe('appointment synchronization', () => {
  it('pushes offline records, pulls Cloud records and does not enqueue a loop', async () => {
    const local = new MemoryLocal();
    local.add('appointment_type', type('local-type'));
    await syncAppointments(
      'appointment_type',
      'b',
      local,
      cloud({ pull: async () => [type('web-type', t2)] }),
    );
    expect(local.rows.has('web-type')).toBe(true);
    expect(local.changes.size).toBe(0);
    await syncAppointments('appointment_type', 'b', local, cloud());
    expect(local.changes.size).toBe(0);
  });

  it('preserves a local reprogramming when Cloud changed concurrently', async () => {
    const local = new MemoryLocal();
    const changed = {
      ...appointment('a'),
      startsAt: '2026-10-11T14:00:00.000Z',
    };
    local.add('appointment', changed);
    const remote = {
      ...appointment('a', t2),
      startsAt: '2026-10-11T15:00:00.000Z',
    };
    const result = await syncAppointments(
      'appointment',
      'b',
      local,
      cloud({ push: async () => ({ kind: 'conflict', entity: remote }) }),
    );
    expect(result.conflicts).toBe(1);
    expect((local.rows.get('a') as Appointment).startsAt).toBe(
      changed.startsAt,
    );
    expect(local.changes.has('a')).toBe(true);
  });

  it('syncs status updates as ordinary mutable appointment changes', async () => {
    const local = new MemoryLocal();
    local.add('appointment', { ...appointment('a'), status: 'cancelled' });
    const pushed: AppointmentSyncEntity[] = [];
    await syncAppointments(
      'appointment',
      'b',
      local,
      cloud({
        push: async (_kind, change) => {
          pushed.push(change.entity);
          return {
            kind: 'pushed',
            entity: { ...change.entity, updatedAt: t2 },
          };
        },
      }),
    );
    expect((pushed[0] as Appointment).status).toBe('cancelled');
  });
});
