import type { PhotoJob, PhotoJobItem, PhotoService } from '@centrocolor/domain';
export type PhotoSyncType = 'photo_service' | 'photo_job' | 'photo_job_item';
export type PhotoSyncEntity = PhotoService | PhotoJob | PhotoJobItem;
export interface PhotoSyncCursor {
  updatedAt: string;
  id: string;
}
export interface PendingPhotoChange {
  outboxId: string;
  entityType: PhotoSyncType;
  entity: PhotoSyncEntity;
  localRevision: number;
  cloudUpdatedAt: string | null;
}
export interface PhotoSyncLocalPort {
  pending(
    type: PhotoSyncType,
    businessId: string,
    limit: number,
  ): Promise<PendingPhotoChange[]>;
  pendingFor(
    type: PhotoSyncType,
    businessId: string,
    id: string,
  ): Promise<PendingPhotoChange | null>;
  acknowledge(
    change: PendingPhotoChange,
    cloud: PhotoSyncEntity,
  ): Promise<void>;
  fail(change: PendingPhotoChange, message: string): Promise<void>;
  conflict(change: PendingPhotoChange, cloud: PhotoSyncEntity): Promise<void>;
  applyRemote(type: PhotoSyncType, entity: PhotoSyncEntity): Promise<boolean>;
  cursor(
    type: PhotoSyncType,
    businessId: string,
  ): Promise<PhotoSyncCursor | null>;
  advanceCursor(
    type: PhotoSyncType,
    businessId: string,
    cursor: PhotoSyncCursor,
  ): Promise<void>;
}
export interface PhotoSyncCloudPort {
  push(
    type: PhotoSyncType,
    change: PendingPhotoChange,
  ): Promise<{ kind: 'pushed' | 'conflict'; entity: PhotoSyncEntity }>;
  pull(
    type: PhotoSyncType,
    businessId: string,
    after: PhotoSyncCursor | null,
    limit: number,
  ): Promise<PhotoSyncEntity[]>;
}
const compare = (a: PhotoSyncCursor, b: PhotoSyncCursor) =>
  a.updatedAt === b.updatedAt
    ? a.id.localeCompare(b.id)
    : a.updatedAt.localeCompare(b.updatedAt);
export async function syncPhotoEntities(
  type: PhotoSyncType,
  businessId: string,
  local: PhotoSyncLocalPort,
  cloud: PhotoSyncCloudPort,
) {
  const result = { pushed: 0, pulled: 0, conflicts: 0 };
  for (const change of await local.pending(type, businessId, 100)) {
    try {
      const reply = await cloud.push(type, change);
      if (reply.kind === 'conflict') {
        await local.conflict(change, reply.entity);
        result.conflicts++;
      } else {
        await local.acknowledge(change, reply.entity);
        result.pushed++;
      }
    } catch (cause) {
      await local.fail(
        change,
        cause instanceof Error
          ? cause.message
          : 'No se pudo sincronizar Fotografía.',
      );
      throw cause;
    }
  }
  let cursor = await local.cursor(type, businessId);
  for (const entity of await cloud.pull(type, businessId, cursor, 100)) {
    const next = { updatedAt: entity.updatedAt, id: entity.id };
    if (cursor && compare(next, cursor) <= 0)
      throw new Error('Cursor de Fotografía no creciente.');
    const pending = await local.pendingFor(type, businessId, entity.id);
    if (pending && pending.cloudUpdatedAt !== entity.updatedAt) {
      await local.conflict(pending, entity);
      result.conflicts++;
    } else if (!pending && (await local.applyRemote(type, entity)))
      result.pulled++;
    await local.advanceCursor(type, businessId, next);
    cursor = next;
  }
  return result;
}
