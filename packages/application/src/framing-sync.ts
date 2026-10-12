import type {
  FrameJob,
  FrameMaterial,
  FrameMoulding,
  FrameQuote,
  FrameQuoteItem,
  FramingSettings,
} from '@centrocolor/domain';
export type FramingSyncType =
  'moulding' | 'material' | 'settings' | 'quote' | 'quote_item' | 'job';
export type FramingSyncEntity =
  | FrameMoulding
  | FrameMaterial
  | FramingSettings
  | FrameQuote
  | FrameQuoteItem
  | FrameJob;
export interface FramingCursor {
  updatedAt: string;
  id: string;
}
export interface PendingFramingChange {
  outboxId: string;
  entityType: FramingSyncType;
  entity: FramingSyncEntity;
  localRevision: number;
  cloudUpdatedAt: string | null;
}
export interface FramingSyncLocalPort {
  pending(
    type: FramingSyncType,
    businessId: string,
    limit: number,
  ): Promise<PendingFramingChange[]>;
  pendingFor(
    type: FramingSyncType,
    businessId: string,
    id: string,
  ): Promise<PendingFramingChange | null>;
  acknowledge(
    change: PendingFramingChange,
    cloud: FramingSyncEntity,
  ): Promise<void>;
  fail(change: PendingFramingChange, message: string): Promise<void>;
  conflict(
    change: PendingFramingChange,
    cloud: FramingSyncEntity,
  ): Promise<void>;
  applyRemote(
    type: FramingSyncType,
    entity: FramingSyncEntity,
  ): Promise<boolean>;
  cursor(
    type: FramingSyncType,
    businessId: string,
  ): Promise<FramingCursor | null>;
  advanceCursor(
    type: FramingSyncType,
    businessId: string,
    cursor: FramingCursor,
  ): Promise<void>;
}
export interface FramingSyncCloudPort {
  push(
    type: FramingSyncType,
    change: PendingFramingChange,
  ): Promise<{ kind: 'pushed' | 'conflict'; entity: FramingSyncEntity }>;
  pull(
    type: FramingSyncType,
    businessId: string,
    after: FramingCursor | null,
    limit: number,
  ): Promise<FramingSyncEntity[]>;
}
const compare = (a: FramingCursor, b: FramingCursor) =>
  a.updatedAt === b.updatedAt
    ? a.id === b.id
      ? 0
      : a.id < b.id
        ? -1
        : 1
    : a.updatedAt < b.updatedAt
      ? -1
      : 1;
export async function syncFramingEntities(
  type: FramingSyncType,
  businessId: string,
  local: FramingSyncLocalPort,
  cloud: FramingSyncCloudPort,
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
    } catch (e) {
      await local.fail(
        change,
        e instanceof Error ? e.message : 'No se pudo sincronizar Marquetería.',
      );
      throw e;
    }
  }
  let cursor = await local.cursor(type, businessId);
  for (const entity of await cloud.pull(type, businessId, cursor, 100)) {
    const next = {
      updatedAt: entity.updatedAt,
      id: 'id' in entity ? entity.id : businessId,
    };
    if (cursor && compare(next, cursor) <= 0)
      throw new Error('Cursor de Marquetería no creciente.');
    const pending = await local.pendingFor(type, businessId, next.id);
    if (pending) {
      if (pending.cloudUpdatedAt !== entity.updatedAt) {
        await local.conflict(pending, entity);
        result.conflicts++;
      }
    } else if (await local.applyRemote(type, entity)) result.pulled++;
    await local.advanceCursor(type, businessId, next);
    cursor = next;
  }
  return result;
}
