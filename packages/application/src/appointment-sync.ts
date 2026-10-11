import type { Appointment, AppointmentType } from '@centrocolor/domain';

export type AppointmentSyncType = 'appointment_type' | 'appointment';
export type AppointmentSyncEntity = AppointmentType | Appointment;

export interface AppointmentSyncCursor {
  updatedAt: string;
  id: string;
}

export interface PendingAppointmentChange {
  outboxId: string;
  entityType: AppointmentSyncType;
  entity: AppointmentSyncEntity;
  localRevision: number;
  cloudUpdatedAt: string | null;
}

export interface AppointmentSyncLocalPort {
  pending(
    type: AppointmentSyncType,
    businessId: string,
    limit: number,
  ): Promise<PendingAppointmentChange[]>;
  pendingFor(
    type: AppointmentSyncType,
    businessId: string,
    id: string,
  ): Promise<PendingAppointmentChange | null>;
  acknowledge(
    change: PendingAppointmentChange,
    cloud: AppointmentSyncEntity,
  ): Promise<void>;
  fail(change: PendingAppointmentChange, message: string): Promise<void>;
  conflict(
    change: PendingAppointmentChange,
    cloud: AppointmentSyncEntity,
  ): Promise<void>;
  applyRemote(
    type: AppointmentSyncType,
    entity: AppointmentSyncEntity,
  ): Promise<boolean>;
  cursor(
    type: AppointmentSyncType,
    businessId: string,
  ): Promise<AppointmentSyncCursor | null>;
  advanceCursor(
    type: AppointmentSyncType,
    businessId: string,
    cursor: AppointmentSyncCursor,
  ): Promise<void>;
}

export interface AppointmentSyncCloudPort {
  push(
    type: AppointmentSyncType,
    change: PendingAppointmentChange,
  ): Promise<{ kind: 'pushed' | 'conflict'; entity: AppointmentSyncEntity }>;
  pull(
    type: AppointmentSyncType,
    businessId: string,
    after: AppointmentSyncCursor | null,
    limit: number,
  ): Promise<AppointmentSyncEntity[]>;
}

const pageSize = 100;
const cycleLimit = 1000;

function compareCursor(a: AppointmentSyncCursor, b: AppointmentSyncCursor) {
  const time = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  if (time !== 0) return time;
  const fractionA = (a.updatedAt.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0');
  const fractionB = (b.updatedAt.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0');
  if (fractionA !== fractionB) return fractionA < fractionB ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'No se pudo sincronizar la agenda.';
}

export async function syncAppointments(
  type: AppointmentSyncType,
  businessId: string,
  local: AppointmentSyncLocalPort,
  cloud: AppointmentSyncCloudPort,
) {
  const result = { pushed: 0, pulled: 0, conflicts: 0 };
  let processed = 0;
  while (processed < cycleLimit) {
    const pending = await local.pending(
      type,
      businessId,
      Math.min(pageSize, cycleLimit - processed),
    );
    if (!pending.length) break;
    for (const change of pending) {
      if (change.entity.businessId !== businessId)
        throw new Error('Sync de agenda devolvió otro negocio.');
      try {
        const response = await cloud.push(type, change);
        if (response.entity.businessId !== businessId)
          throw new Error('Cloud devolvió otro negocio.');
        if (response.kind === 'conflict') {
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
    if (pending.length < pageSize) break;
  }

  let cursor = await local.cursor(type, businessId);
  processed = 0;
  while (processed < cycleLimit) {
    const rows = await cloud.pull(
      type,
      businessId,
      cursor,
      Math.min(pageSize, cycleLimit - processed),
    );
    if (!rows.length) break;
    for (const entity of rows) {
      if (entity.businessId !== businessId)
        throw new Error('Cloud devolvió otro negocio.');
      const next = { updatedAt: entity.updatedAt, id: entity.id };
      if (cursor && compareCursor(next, cursor) <= 0)
        throw new Error('Cursor de agenda no creciente.');
      const localChange = await local.pendingFor(type, businessId, entity.id);
      if (localChange) {
        if (localChange.cloudUpdatedAt !== entity.updatedAt) {
          await local.conflict(localChange, entity);
          result.conflicts++;
        }
      } else if (await local.applyRemote(type, entity)) {
        result.pulled++;
      } else {
        const raced = await local.pendingFor(type, businessId, entity.id);
        if (!raced)
          throw new Error('No se pudo aplicar el cambio de agenda en SQLite.');
        if (raced.cloudUpdatedAt !== entity.updatedAt) {
          await local.conflict(raced, entity);
          result.conflicts++;
        }
      }
      await local.advanceCursor(type, businessId, next);
      cursor = next;
      processed++;
    }
    if (rows.length < pageSize) break;
  }
  return result;
}
