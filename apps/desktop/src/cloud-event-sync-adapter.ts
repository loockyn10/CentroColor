import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EventPushResult,
  EventSyncCloudPort,
  EventSyncCursor,
  EventSyncEntity,
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

type Row = Record<string, unknown> & {
  id: string;
  business_id: string;
  created_at: string;
  updated_at: string;
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
      isActive: row.is_active as boolean,
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
      isActive: row.is_active as boolean,
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
      name: row.name as string,
      description: row.description as string | null,
      quantity: row.quantity as number,
      unitPriceCents: row.unit_price_cents as number,
      totalCents: row.total_cents as number,
      isActive: row.is_active as boolean,
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
    isActive: row.is_active as boolean,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as ResourceReservation;
}
function details(
  type: EventSyncType,
  entity: EventSyncEntity,
): Record<string, unknown> {
  if (type === 'event_type') {
    const x = entity as EventType;
    return { name: x.name, is_active: x.isActive };
  }
  if (type === 'resource') {
    const x = entity as Resource;
    return {
      name: x.name,
      description: x.description,
      default_price_cents: x.defaultPriceCents,
      is_active: x.isActive,
    };
  }
  if (type === 'event') {
    const x = entity as Event;
    return {
      customer_id: x.customerId,
      event_type_id: x.eventTypeId,
      title: x.title,
      starts_at: x.startsAt,
      ends_at: x.endsAt,
      venue_name: x.venueName,
      venue_address: x.venueAddress,
      status: x.status,
      notes: x.notes,
    };
  }
  if (type === 'event_service_item') {
    const x = entity as EventServiceItem;
    return {
      event_id: x.eventId,
      source_service_id: x.sourceServiceId,
      name: x.name,
      description: x.description,
      quantity: x.quantity,
      unit_price_cents: x.unitPriceCents,
      total_cents: x.totalCents,
      is_active: x.isActive,
    };
  }
  const x = entity as ResourceReservation;
  return {
    event_id: x.eventId,
    resource_id: x.resourceId,
    starts_at: x.startsAt,
    ends_at: x.endsAt,
    price_cents: x.priceCents,
    notes: x.notes,
    is_active: x.isActive,
  };
}
function insertDetails(type: EventSyncType, entity: EventSyncEntity) {
  if (type === 'event') {
    const x = entity as Event;
    return {
      branch_id: x.branchId,
      created_by: x.createdBy,
      ...details(type, entity),
    };
  }
  return details(type, entity);
}
const same = (type: EventSyncType, a: EventSyncEntity, b: EventSyncEntity) =>
  a.id === b.id &&
  a.businessId === b.businessId &&
  JSON.stringify(details(type, a)) === JSON.stringify(details(type, b));

export class CloudEventSyncAdapter implements EventSyncCloudPort {
  constructor(private readonly client: SupabaseClient) {}
  async get(type: EventSyncType, businessId: string, id: string) {
    const { data, error } = await this.client
      .from(table(type))
      .select('*')
      .eq('business_id', businessId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? decode(type, data as Row) : null;
  }
  private async conflictReservation(
    businessId: string,
    error: { details?: string | null },
  ): Promise<ResourceReservation | null> {
    const id = error.details?.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
    if (!id) return null;
    return (await this.get(
      'resource_reservation',
      businessId,
      id,
    )) as ResourceReservation | null;
  }
  async push(
    type: EventSyncType,
    change: PendingEventChange,
  ): Promise<EventPushResult> {
    const { entity, cloudUpdatedAt } = change;
    if (cloudUpdatedAt === null) {
      const { data, error } = await this.client
        .from(table(type))
        .insert({
          id: entity.id,
          business_id: entity.businessId,
          created_at: entity.createdAt,
          ...insertDetails(type, entity),
        })
        .select('*')
        .single();
      if (!error) return { kind: 'pushed', entity: decode(type, data as Row) };
      if (error.code === '23P01') {
        const conflict = await this.conflictReservation(
          entity.businessId,
          error,
        );
        if (conflict)
          return {
            kind: 'availability_conflict',
            entity,
            conflictingReservation: conflict,
          };
      }
      if (error.code !== '23505') throw error;
    } else {
      const { data, error } = await this.client
        .from(table(type))
        .update(details(type, entity))
        .eq('business_id', entity.businessId)
        .eq('id', entity.id)
        .eq('updated_at', cloudUpdatedAt)
        .select('*')
        .maybeSingle();
      if (error?.code === '23P01') {
        const conflict = await this.conflictReservation(
          entity.businessId,
          error,
        );
        if (conflict)
          return {
            kind: 'availability_conflict',
            entity,
            conflictingReservation: conflict,
          };
      }
      if (error) throw error;
      if (data) return { kind: 'pushed', entity: decode(type, data as Row) };
    }
    const remote = await this.get(type, entity.businessId, entity.id);
    if (!remote)
      throw new Error('El registro de Eventos no pudo guardarse en Cloud.');
    return {
      kind: same(type, remote, entity) ? 'pushed' : 'conflict',
      entity: remote,
    };
  }
  async pull(
    type: EventSyncType,
    businessId: string,
    after: EventSyncCursor | null,
    limit: number,
  ) {
    let q = this.client
      .from(table(type))
      .select('*')
      .eq('business_id', businessId);
    if (after)
      q = q.or(
        `updated_at.gt.${after.updatedAt},and(updated_at.eq.${after.updatedAt},id.gt.${after.id})`,
      );
    const { data, error } = await q
      .order('updated_at')
      .order('id')
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => decode(type, row as Row));
  }
}
