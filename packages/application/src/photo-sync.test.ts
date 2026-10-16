import { describe, expect, it } from 'vitest';
import {
  syncPhotoEntities,
  type PhotoSyncCloudPort,
  type PhotoSyncLocalPort,
} from './photo-sync';
import type { PhotoJob } from '@centrocolor/domain';

describe('photo sync', () => {
  it('hace push/pull idempotente y detecta conflicto de estado', async () => {
    const entity: PhotoJob = {
      id: 'j',
      businessId: 'b',
      branchId: 'r',
      customerId: 'c',
      status: 'in_progress',
      priority: 'normal',
      promisedAt: null,
      notes: null,
      sourceAppointmentId: null,
      sourceEventId: null,
      createdBy: 'u',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const calls: string[] = [];
    const local: PhotoSyncLocalPort = {
      pending: async () => [
        {
          outboxId: 'o',
          entityType: 'photo_job',
          entity,
          localRevision: 1,
          cloudUpdatedAt: null,
        },
      ],
      pendingFor: async () => null,
      acknowledge: async () => {
        calls.push('ack');
      },
      fail: async () => {},
      conflict: async () => {
        calls.push('conflict');
      },
      applyRemote: async () => {
        calls.push('pull');
        return true;
      },
      cursor: async () => null,
      advanceCursor: async () => {},
    };
    const cloud: PhotoSyncCloudPort = {
      push: async () => ({ kind: 'pushed', entity }),
      pull: async () => [
        { ...entity, id: 'remote', updatedAt: '2026-01-02T00:00:00Z' },
      ],
    };
    expect(await syncPhotoEntities('photo_job', 'b', local, cloud)).toEqual({
      pushed: 1,
      pulled: 1,
      conflicts: 0,
    });
    expect(calls).toEqual(['ack', 'pull']);
  });
});
