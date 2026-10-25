import Database from '@tauri-apps/plugin-sql';
import type {
  EventSyncCursor,
  EventSyncEntity,
  EventSyncLocalPort,
  EventSyncType,
  PendingEventChange,
} from '@centrocolor/application';
import type {
  Event,
  EventServiceItem,
  EventStatus,
  EventType,
  Resource,
  ResourceReservation,
} from '@centrocolor/domain';

const database = () => Database.load('sqlite:centrocolor.db');
type Row = Record<string, unknown> & {
  id: string;
  business_id: string;
  created_at: string;
  updated_at: string;
  cloud_updated_at: string | null;
  local_revision: number;
  outbox_id?: string;
};
type OutboxRow = {
  id: string;
  entity_id: string;
  entity_type: EventSyncType;
  local_revision: number;
  remote_snapshot: string | null;
  remote_updated_at: string | null;
  conflict_kind: 'version' | 'availability' | null;
};
const table = (type: EventSyncType) =>
  (
    ({
      event_type: 'event_types',
      resource: 'resources',
      event: 'events',
      event_service_item: 'event_service_items',
      resource_reservation: 'resource_reservations',
    }) as const
  )[type];
function decode(type: EventSyncType, row: Row): EventSyncEntity {
  if (type === 'event_type')
    return {
      id: row.id,
      businessId: row.business_id,
      name: row.name as string,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as EventType;
  if (type === 'resource')
    return {
      id: row.id,
      businessId: row.business_id,
      name: row.name as string,
      description: row.description as string | null,
      defaultPriceCents: row.default_price_cents as number | null,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as Resource;
  if (type === 'event')
    return {
      id: row.id,
      businessId: row.business_id,
      branchId: row.branch_id as string,
      customerId: row.customer_id as string,
      eventTypeId: row.event_type_id as string | null,
      title: row.title as string,
      startsAt: row.starts_at as string,
      endsAt: row.ends_at as string,
      venueName: row.venue_name as string | null,
      venueAddress: row.venue_address as string | null,
      status: row.status as EventStatus,
      notes: row.notes as string | null,
      createdBy: row.created_by as string,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as Event;
  if (type === 'event_service_item')
    return {
      id: row.id,
      businessId: row.business_id,
      eventId: row.event_id as string,
      sourceServiceId: row.source_service_id as string | null,
      priceListId: row.price_list_id as string | null,
      configSnapshot: row.config_snapshot
        ? (JSON.parse(row.config_snapshot as string) as Record<string, unknown>)
        : null,
      name: row.name as string,
      description: row.description as string | null,
      quantity: row.quantity as number,
      unitPriceCents: row.unit_price_cents as number,
      totalCents: row.total_cents as number,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as EventServiceItem;
  return {
    id: row.id,
    businessId: row.business_id,
    eventId: row.event_id as string,
    resourceId: row.resource_id as string,
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
    priceCents: row.price_cents as number,
    notes: row.notes as string | null,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as ResourceReservation;
}
const pending = (type: EventSyncType, row: Row): PendingEventChange => ({
  outboxId: row.outbox_id!,
  entityType: type,
  entity: decode(type, row),
  localRevision: row.local_revision,
  cloudUpdatedAt: row.cloud_updated_at,
});
const describe = (type: EventSyncType, x: EventSyncEntity) =>
  type === 'event_type'
    ? (x as EventType).name
    : type === 'resource'
      ? (x as Resource).name
      : type === 'event'
        ? (x as Event).title
        : type === 'event_service_item'
          ? `${(x as EventServiceItem).name} · ${(x as EventServiceItem).quantity}`
          : `${new Date((x as ResourceReservation).startsAt).toLocaleString('es-AR')} → ${new Date((x as ResourceReservation).endsAt).toLocaleString('es-AR')}`;
export interface EventSyncSummary {
  pending: number;
  conflicts: number;
  lastError: string | null;
}
export interface EventConflict {
  id: string;
  type: EventSyncType;
  kind: 'version' | 'availability';
  label: string;
  localRevision: number;
  cloudUpdatedAt: string | null;
  localSummary: string;
  cloudSummary: string;
}

export class SQLiteEventSyncAdapter implements EventSyncLocalPort {
  async pending(type: EventSyncType, businessId: string, limit: number) {
    const db = await database();
    const rows = await db.select<Row[]>(
      `SELECT t.*,o.id AS outbox_id,o.local_revision FROM event_sync_outbox o JOIN ${table(type)} t ON t.business_id=o.business_id AND t.id=o.entity_id WHERE o.business_id=? AND o.entity_type=? AND o.status='pending' ORDER BY o.created_at,o.id LIMIT ?`,
      [businessId, type, limit],
    );
    return rows.map((r) => pending(type, r));
  }
  async pendingFor(type: EventSyncType, businessId: string, id: string) {
    const db = await database();
    const rows = await db.select<Row[]>(
      `SELECT t.*,o.id AS outbox_id,o.local_revision FROM event_sync_outbox o JOIN ${table(type)} t ON t.business_id=o.business_id AND t.id=o.entity_id WHERE o.business_id=? AND o.entity_type=? AND o.entity_id=? LIMIT 1`,
      [businessId, type, id],
    );
    return rows[0] ? pending(type, rows[0]) : null;
  }
  async acknowledge(change: PendingEventChange, cloud: EventSyncEntity) {
    const db = await database();
    await db.execute(
      `UPDATE ${table(change.entityType)} SET cloud_updated_at=?,updated_at=CASE WHEN local_revision=? THEN ? ELSE updated_at END WHERE business_id=? AND id=?`,
      [
        cloud.updatedAt,
        change.localRevision,
        cloud.updatedAt,
        change.entity.businessId,
        change.entity.id,
      ],
    );
    await db.execute(
      `DELETE FROM event_sync_outbox WHERE id=? AND business_id=? AND entity_type=? AND entity_id=? AND local_revision=? AND status='pending'`,
      [
        change.outboxId,
        change.entity.businessId,
        change.entityType,
        change.entity.id,
        change.localRevision,
      ],
    );
  }
  async fail(change: PendingEventChange, message: string) {
    const db = await database();
    await db.execute(
      `UPDATE event_sync_outbox SET attempts=attempts+1,last_error=? WHERE id=? AND status='pending'`,
      [message.slice(0, 500), change.outboxId],
    );
  }
  async conflict(change: PendingEventChange, cloud: EventSyncEntity) {
    const db = await database();
    await db.execute(
      `UPDATE event_sync_outbox SET status='conflict',conflict_kind='version',last_error=?,remote_updated_at=?,remote_snapshot=? WHERE id=? AND business_id=? AND entity_type=?`,
      [
        'El registro también cambió en Cloud. Requiere resolución.',
        cloud.updatedAt,
        JSON.stringify(cloud),
        change.outboxId,
        change.entity.businessId,
        change.entityType,
      ],
    );
  }
  async availabilityConflict(
    change: PendingEventChange,
    cloud: ResourceReservation,
  ) {
    const db = await database();
    if (change.entityType === 'event') {
      await db.execute(
        `INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision,attempts,last_error,status,conflict_kind,remote_updated_at,remote_snapshot)
         SELECT lower(hex(randomblob(16))),rr.business_id,'resource_reservation',rr.id,rr.updated_at,rr.local_revision,0,?,'conflict','availability',?,?
         FROM resource_reservations rr
         WHERE rr.business_id=? AND rr.event_id=? AND rr.resource_id=? AND rr.is_active=1
           AND julianday(rr.starts_at)<julianday(?) AND julianday(rr.ends_at)>julianday(?)
         ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
           local_revision=excluded.local_revision,attempts=0,last_error=excluded.last_error,
           status='conflict',conflict_kind='availability',
           remote_updated_at=excluded.remote_updated_at,remote_snapshot=excluded.remote_snapshot`,
        [
          'El recurso fue reservado en Cloud para un horario superpuesto. Editá o desactivá la reserva local.',
          cloud.updatedAt,
          JSON.stringify(cloud),
          change.entity.businessId,
          change.entity.id,
          cloud.resourceId,
          cloud.endsAt,
          cloud.startsAt,
        ],
      );
      await db.execute(
        `UPDATE event_sync_outbox SET attempts=attempts+1,last_error=? WHERE id=? AND business_id=? AND entity_type='event' AND status='pending'`,
        [
          'Cloud rechazó el estado porque una reserva local se superpone. Resolvé la reserva marcada y se reintentará el evento.',
          change.outboxId,
          change.entity.businessId,
        ],
      );
      return;
    }
    await db.execute(
      `UPDATE event_sync_outbox SET status='conflict',conflict_kind='availability',last_error=?,remote_updated_at=?,remote_snapshot=? WHERE id=? AND business_id=? AND entity_type=?`,
      [
        'El recurso fue reservado en Cloud para un horario superpuesto. Editá o desactivá la reserva local.',
        cloud.updatedAt,
        JSON.stringify(cloud),
        change.outboxId,
        change.entity.businessId,
        change.entityType,
      ],
    );
  }
  async applyRemote(type: EventSyncType, entity: EventSyncEntity) {
    const db = await database();
    if (type === 'resource_reservation') {
      const x = entity as ResourceReservation;
      const status = await db.select<{ status: EventStatus }[]>(
        `SELECT status FROM events WHERE business_id=? AND id=?`,
        [x.businessId, x.eventId],
      );
      if (x.isActive && ['reserved', 'completed'].includes(status[0]?.status)) {
        const conflicts = await db.select<{ outbox_id: string }[]>(
          `SELECT o.id AS outbox_id FROM resource_reservations rr JOIN events e ON e.business_id=rr.business_id AND e.id=rr.event_id JOIN event_sync_outbox o ON o.business_id=rr.business_id AND o.entity_type='resource_reservation' AND o.entity_id=rr.id WHERE rr.business_id=? AND rr.resource_id=? AND rr.id<>? AND rr.is_active=1 AND e.status IN ('reserved','completed') AND julianday(rr.starts_at)<julianday(?) AND julianday(rr.ends_at)>julianday(?)`,
          [x.businessId, x.resourceId, x.id, x.endsAt, x.startsAt],
        );
        for (const conflict of conflicts)
          await db.execute(
            `UPDATE event_sync_outbox SET status='conflict',conflict_kind='availability',last_error=?,remote_updated_at=?,remote_snapshot=? WHERE id=?`,
            [
              'El recurso fue reservado en Cloud para un horario superpuesto. Editá o desactivá la reserva local.',
              x.updatedAt,
              JSON.stringify(x),
              conflict.outbox_id,
            ],
          );
      }
    }
    const guard = ` AND NOT EXISTS (SELECT 1 FROM event_sync_outbox o WHERE o.business_id=excluded.business_id AND o.entity_type='${type}' AND o.entity_id=excluded.id)`;
    let result;
    if (type === 'event_type') {
      const x = entity as EventType;
      result = await db.execute(
        `INSERT INTO event_types(id,business_id,name,is_active,created_at,updated_at,sync_origin,cloud_updated_at) VALUES(?,?,?,?,?,?,'remote',?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,is_active=excluded.is_active,created_at=excluded.created_at,updated_at=excluded.updated_at,sync_origin='remote',cloud_updated_at=excluded.cloud_updated_at WHERE event_types.business_id=excluded.business_id${guard}`,
        [
          x.id,
          x.businessId,
          x.name,
          x.isActive ? 1 : 0,
          x.createdAt,
          x.updatedAt,
          x.updatedAt,
        ],
      );
    } else if (type === 'resource') {
      const x = entity as Resource;
      result = await db.execute(
        `INSERT INTO resources(id,business_id,name,description,default_price_cents,is_active,created_at,updated_at,sync_origin,cloud_updated_at) VALUES(?,?,?,?,?,?,?,?,'remote',?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,default_price_cents=excluded.default_price_cents,is_active=excluded.is_active,created_at=excluded.created_at,updated_at=excluded.updated_at,sync_origin='remote',cloud_updated_at=excluded.cloud_updated_at WHERE resources.business_id=excluded.business_id${guard}`,
        [
          x.id,
          x.businessId,
          x.name,
          x.description,
          x.defaultPriceCents,
          x.isActive ? 1 : 0,
          x.createdAt,
          x.updatedAt,
          x.updatedAt,
        ],
      );
    } else if (type === 'event') {
      const x = entity as Event;
      result = await db.execute(
        `INSERT INTO events(id,business_id,branch_id,customer_id,event_type_id,title,starts_at,ends_at,venue_name,venue_address,status,notes,created_by,created_at,updated_at,sync_origin,cloud_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'remote',?) ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,event_type_id=excluded.event_type_id,title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,venue_name=excluded.venue_name,venue_address=excluded.venue_address,status=excluded.status,notes=excluded.notes,created_at=excluded.created_at,updated_at=excluded.updated_at,sync_origin='remote',cloud_updated_at=excluded.cloud_updated_at WHERE events.business_id=excluded.business_id${guard}`,
        [
          x.id,
          x.businessId,
          x.branchId,
          x.customerId,
          x.eventTypeId,
          x.title,
          x.startsAt,
          x.endsAt,
          x.venueName,
          x.venueAddress,
          x.status,
          x.notes,
          x.createdBy,
          x.createdAt,
          x.updatedAt,
          x.updatedAt,
        ],
      );
    } else if (type === 'event_service_item') {
      const x = entity as EventServiceItem;
      result = await db.execute(
        `INSERT INTO event_service_items(id,business_id,event_id,source_service_id,name,description,quantity,unit_price_cents,total_cents,is_active,created_at,updated_at,price_list_id,config_snapshot,sync_origin,cloud_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'remote',?) ON CONFLICT(id) DO UPDATE SET source_service_id=excluded.source_service_id,name=excluded.name,description=excluded.description,quantity=excluded.quantity,unit_price_cents=excluded.unit_price_cents,total_cents=excluded.total_cents,is_active=excluded.is_active,price_list_id=excluded.price_list_id,config_snapshot=excluded.config_snapshot,created_at=excluded.created_at,updated_at=excluded.updated_at,sync_origin='remote',cloud_updated_at=excluded.cloud_updated_at WHERE event_service_items.business_id=excluded.business_id${guard}`,
        [
          x.id,
          x.businessId,
          x.eventId,
          x.sourceServiceId,
          x.name,
          x.description,
          x.quantity,
          x.unitPriceCents,
          x.totalCents,
          x.isActive ? 1 : 0,
          x.createdAt,
          x.updatedAt,
          x.priceListId ?? null,
          x.configSnapshot ? JSON.stringify(x.configSnapshot) : null,
          x.updatedAt,
        ],
      );
    } else {
      const x = entity as ResourceReservation;
      result = await db.execute(
        `INSERT INTO resource_reservations(id,business_id,event_id,resource_id,starts_at,ends_at,price_cents,notes,is_active,created_at,updated_at,sync_origin,cloud_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'remote',?) ON CONFLICT(id) DO UPDATE SET resource_id=excluded.resource_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,price_cents=excluded.price_cents,notes=excluded.notes,is_active=excluded.is_active,created_at=excluded.created_at,updated_at=excluded.updated_at,sync_origin='remote',cloud_updated_at=excluded.cloud_updated_at WHERE resource_reservations.business_id=excluded.business_id${guard}`,
        [
          x.id,
          x.businessId,
          x.eventId,
          x.resourceId,
          x.startsAt,
          x.endsAt,
          x.priceCents,
          x.notes,
          x.isActive ? 1 : 0,
          x.createdAt,
          x.updatedAt,
          x.updatedAt,
        ],
      );
    }
    return result.rowsAffected > 0;
  }
  async cursor(type: EventSyncType, businessId: string) {
    const db = await database();
    const rows = await db.select<{ updated_at: string; entity_id: string }[]>(
      `SELECT updated_at,entity_id FROM event_sync_cursor WHERE business_id=? AND entity_type=?`,
      [businessId, type],
    );
    return rows[0]
      ? { updatedAt: rows[0].updated_at, id: rows[0].entity_id }
      : null;
  }
  async advanceCursor(
    type: EventSyncType,
    businessId: string,
    cursor: EventSyncCursor,
  ) {
    const db = await database();
    await db.execute(
      `INSERT INTO event_sync_cursor(business_id,entity_type,updated_at,entity_id,last_success_at) VALUES(?,?,?,?,?) ON CONFLICT(business_id,entity_type) DO UPDATE SET updated_at=excluded.updated_at,entity_id=excluded.entity_id,last_success_at=excluded.last_success_at`,
      [businessId, type, cursor.updatedAt, cursor.id, new Date().toISOString()],
    );
  }
  async summary(businessId: string): Promise<EventSyncSummary> {
    const db = await database();
    const rows = await db.select<{ status: string; count: number }[]>(
      `SELECT status,count(*) AS count FROM event_sync_outbox WHERE business_id=? GROUP BY status`,
      [businessId],
    );
    const errors = await db.select<{ last_error: string | null }[]>(
      `SELECT last_error FROM event_sync_outbox WHERE business_id=? AND last_error IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [businessId],
    );
    return {
      pending: rows.find((x) => x.status === 'pending')?.count ?? 0,
      conflicts: rows.find((x) => x.status === 'conflict')?.count ?? 0,
      lastError: errors[0]?.last_error ?? null,
    };
  }
  async conflicts(businessId: string): Promise<EventConflict[]> {
    const db = await database();
    const rows = await db.select<OutboxRow[]>(
      `SELECT id,entity_id,entity_type,local_revision,remote_snapshot,remote_updated_at,conflict_kind FROM event_sync_outbox WHERE business_id=? AND status='conflict' ORDER BY created_at LIMIT 20`,
      [businessId],
    );
    return Promise.all(
      rows.map(async (row) => {
        const localRows = await db.select<Row[]>(
          `SELECT * FROM ${table(row.entity_type)} WHERE business_id=? AND id=?`,
          [businessId, row.entity_id],
        );
        const local = localRows[0]
          ? decode(row.entity_type, localRows[0])
          : null;
        let cloud: EventSyncEntity | null = null;
        try {
          if (row.remote_snapshot)
            cloud = JSON.parse(row.remote_snapshot) as EventSyncEntity;
        } catch {
          /* keep visible */
        }
        return {
          id: row.entity_id,
          type: row.entity_type,
          kind: row.conflict_kind ?? 'version',
          label: local ? describe(row.entity_type, local) : row.entity_id,
          localRevision: row.local_revision,
          cloudUpdatedAt: row.remote_updated_at,
          localSummary: local
            ? describe(row.entity_type, local)
            : 'No disponible',
          cloudSummary: cloud
            ? describe(
                row.conflict_kind === 'availability'
                  ? 'resource_reservation'
                  : row.entity_type,
                cloud,
              )
            : 'No disponible',
        };
      }),
    );
  }
  async keepLocal(
    type: EventSyncType,
    cloud: EventSyncEntity,
    revision: number,
  ) {
    const db = await database();
    const result = await db.execute(
      `UPDATE ${table(type)} SET cloud_updated_at=? WHERE business_id=? AND id=? AND local_revision=? AND EXISTS (SELECT 1 FROM event_sync_outbox o WHERE o.business_id=? AND o.entity_type=? AND o.entity_id=? AND o.local_revision=? AND o.status='conflict' AND o.conflict_kind='version')`,
      [
        cloud.updatedAt,
        cloud.businessId,
        cloud.id,
        revision,
        cloud.businessId,
        type,
        cloud.id,
        revision,
      ],
    );
    if (!result.rowsAffected)
      throw new Error('El registro local volvió a cambiar.');
    await db.execute(
      `UPDATE event_sync_outbox SET status='pending',conflict_kind=NULL,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL WHERE business_id=? AND entity_type=? AND entity_id=? AND local_revision=?`,
      [cloud.businessId, type, cloud.id, revision],
    );
  }
  async keepCloud(
    type: EventSyncType,
    cloud: EventSyncEntity,
    revision: number,
  ) {
    const db = await database();
    const guard = `WHERE business_id=? AND id=? AND local_revision=? AND EXISTS (
      SELECT 1 FROM event_sync_outbox o WHERE o.business_id=? AND o.entity_type=?
      AND o.entity_id=? AND o.local_revision=? AND o.status='conflict' AND o.conflict_kind='version')`;
    const common = [
      cloud.businessId,
      cloud.id,
      revision,
      cloud.businessId,
      type,
      cloud.id,
      revision,
    ];
    let result;
    if (type === 'event_type') {
      const value = cloud as EventType;
      result = await db.execute(
        `UPDATE event_types SET name=?,is_active=?,created_at=?,updated_at=?,cloud_updated_at=?,sync_origin='remote' ${guard}`,
        [
          value.name,
          value.isActive ? 1 : 0,
          value.createdAt,
          value.updatedAt,
          value.updatedAt,
          ...common,
        ],
      );
    } else if (type === 'resource') {
      const value = cloud as Resource;
      result = await db.execute(
        `UPDATE resources SET name=?,description=?,default_price_cents=?,is_active=?,created_at=?,updated_at=?,cloud_updated_at=?,sync_origin='remote' ${guard}`,
        [
          value.name,
          value.description,
          value.defaultPriceCents,
          value.isActive ? 1 : 0,
          value.createdAt,
          value.updatedAt,
          value.updatedAt,
          ...common,
        ],
      );
    } else if (type === 'event') {
      const value = cloud as Event;
      result = await db.execute(
        `UPDATE events SET branch_id=?,customer_id=?,event_type_id=?,title=?,starts_at=?,ends_at=?,venue_name=?,venue_address=?,status=?,notes=?,created_by=?,created_at=?,updated_at=?,cloud_updated_at=?,sync_origin='remote' ${guard}`,
        [
          value.branchId,
          value.customerId,
          value.eventTypeId,
          value.title,
          value.startsAt,
          value.endsAt,
          value.venueName,
          value.venueAddress,
          value.status,
          value.notes,
          value.createdBy,
          value.createdAt,
          value.updatedAt,
          value.updatedAt,
          ...common,
        ],
      );
    } else if (type === 'event_service_item') {
      const value = cloud as EventServiceItem;
      result = await db.execute(
        `UPDATE event_service_items SET event_id=?,source_service_id=?,name=?,description=?,quantity=?,unit_price_cents=?,total_cents=?,is_active=?,created_at=?,updated_at=?,price_list_id=?,config_snapshot=?,cloud_updated_at=?,sync_origin='remote' ${guard}`,
        [
          value.eventId,
          value.sourceServiceId,
          value.name,
          value.description,
          value.quantity,
          value.unitPriceCents,
          value.totalCents,
          value.isActive ? 1 : 0,
          value.createdAt,
          value.updatedAt,
          value.priceListId ?? null,
          value.configSnapshot ? JSON.stringify(value.configSnapshot) : null,
          value.updatedAt,
          ...common,
        ],
      );
    } else {
      const value = cloud as ResourceReservation;
      result = await db.execute(
        `UPDATE resource_reservations SET event_id=?,resource_id=?,starts_at=?,ends_at=?,price_cents=?,notes=?,is_active=?,created_at=?,updated_at=?,cloud_updated_at=?,sync_origin='remote' ${guard}`,
        [
          value.eventId,
          value.resourceId,
          value.startsAt,
          value.endsAt,
          value.priceCents,
          value.notes,
          value.isActive ? 1 : 0,
          value.createdAt,
          value.updatedAt,
          value.updatedAt,
          ...common,
        ],
      );
    }
    if (!result.rowsAffected)
      throw new Error('El registro local volvió a cambiar.');
    await db.execute(
      `DELETE FROM event_sync_outbox WHERE business_id=? AND entity_type=? AND entity_id=? AND local_revision=? AND status='conflict' AND conflict_kind='version'`,
      [cloud.businessId, type, cloud.id, revision],
    );
  }
}
