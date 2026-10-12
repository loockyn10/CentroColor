import type {
  Event,
  EventServiceItem,
  EventType,
  Resource,
  ResourceReservation,
} from '@centrocolor/domain';

export type EventSyncType =
  | 'event_type'
  | 'resource'
  | 'event'
  | 'event_service_item'
  | 'resource_reservation';
export type EventSyncEntity =
  EventType | Resource | Event | EventServiceItem | ResourceReservation;
export interface EventSyncCursor {
  updatedAt: string;
  id: string;
}
export interface PendingEventChange {
  outboxId: string;
  entityType: EventSyncType;
  entity: EventSyncEntity;
  localRevision: number;
  cloudUpdatedAt: string | null;
}
export type EventPushResult =
  | { kind: 'pushed' | 'conflict'; entity: EventSyncEntity }
  | {
      kind: 'availability_conflict';
      entity: EventSyncEntity;
      conflictingReservation: ResourceReservation;
    };

export interface EventSyncLocalPort {
  pending(
    type: EventSyncType,
    businessId: string,
    limit: number,
  ): Promise<PendingEventChange[]>;
  pendingFor(
    type: EventSyncType,
    businessId: string,
    id: string,
  ): Promise<PendingEventChange | null>;
  acknowledge(
    change: PendingEventChange,
    cloud: EventSyncEntity,
  ): Promise<void>;
  fail(change: PendingEventChange, message: string): Promise<void>;
  conflict(change: PendingEventChange, cloud: EventSyncEntity): Promise<void>;
  availabilityConflict(
    change: PendingEventChange,
    cloud: ResourceReservation,
  ): Promise<void>;
  applyRemote(type: EventSyncType, entity: EventSyncEntity): Promise<boolean>;
  cursor(
    type: EventSyncType,
    businessId: string,
  ): Promise<EventSyncCursor | null>;
  advanceCursor(
    type: EventSyncType,
    businessId: string,
    cursor: EventSyncCursor,
  ): Promise<void>;
}
export interface EventSyncCloudPort {
  push(
    type: EventSyncType,
    change: PendingEventChange,
  ): Promise<EventPushResult>;
  pull(
    type: EventSyncType,
    businessId: string,
    after: EventSyncCursor | null,
    limit: number,
  ): Promise<EventSyncEntity[]>;
}

const compare = (a: EventSyncCursor, b: EventSyncCursor) => {
  const time = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  if (time) return time;
  const fa = (a.updatedAt.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0');
  const fb = (b.updatedAt.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0');
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo sincronizar Eventos.';

export async function syncEventEntities(
  type: EventSyncType,
  businessId: string,
  local: EventSyncLocalPort,
  cloud: EventSyncCloudPort,
) {
  const result = { pushed: 0, pulled: 0, conflicts: 0 };
  let processed = 0;
  while (processed < 1000) {
    const page = await local.pending(
      type,
      businessId,
      Math.min(100, 1000 - processed),
    );
    if (!page.length) break;
    for (const change of page) {
      if (change.entity.businessId !== businessId)
        throw new Error('Sync de Eventos devolvió otro negocio.');
      try {
        const response = await cloud.push(type, change);
        if (response.entity.businessId !== businessId)
          throw new Error('Cloud devolvió otro negocio.');
        if (response.kind === 'availability_conflict') {
          await local.availabilityConflict(
            change,
            response.conflictingReservation,
          );
          result.conflicts++;
        } else if (response.kind === 'conflict') {
          await local.conflict(change, response.entity);
          result.conflicts++;
        } else {
          await local.acknowledge(change, response.entity);
          result.pushed++;
        }
      } catch (error) {
        await local.fail(change, message(error));
        throw error;
      }
      processed++;
    }
    if (page.length < 100) break;
  }
  let cursor = await local.cursor(type, businessId);
  processed = 0;
  while (processed < 1000) {
    const page = await cloud.pull(
      type,
      businessId,
      cursor,
      Math.min(100, 1000 - processed),
    );
    if (!page.length) break;
    for (const entity of page) {
      if (entity.businessId !== businessId)
        throw new Error('Cloud devolvió otro negocio.');
      const next = { updatedAt: entity.updatedAt, id: entity.id };
      if (cursor && compare(next, cursor) <= 0)
        throw new Error('Cursor de Eventos no creciente.');
      const pending = await local.pendingFor(type, businessId, entity.id);
      if (pending) {
        if (pending.cloudUpdatedAt !== entity.updatedAt) {
          await local.conflict(pending, entity);
          result.conflicts++;
        }
      } else if (await local.applyRemote(type, entity)) result.pulled++;
      else {
        const raced = await local.pendingFor(type, businessId, entity.id);
        if (!raced)
          throw new Error('No se pudo aplicar el cambio de Eventos en SQLite.');
        if (raced.cloudUpdatedAt !== entity.updatedAt) {
          await local.conflict(raced, entity);
          result.conflicts++;
        }
      }
      await local.advanceCursor(type, businessId, next);
      cursor = next;
      processed++;
    }
    if (page.length < 100) break;
  }
  return result;
}
