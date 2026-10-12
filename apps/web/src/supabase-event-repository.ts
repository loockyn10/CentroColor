import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EventBundle,
  EventListQuery,
  EventRepository,
  EventSummary,
  ResourceReservationQuery,
  ResourceReservationSummary,
} from '@centrocolor/application';
import type {
  Event,
  EventDetails,
  EventServiceItem,
  EventStatus,
  EventType,
  EventTypeDetails,
  Resource,
  ResourceDetails,
  ResourceReservation,
} from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';

type TypeRow = {
  id: string;
  business_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
type ResourceRow = TypeRow & {
  description: string | null;
  default_price_cents: number | null;
};
type EventRow = {
  id: string;
  business_id: string;
  branch_id: string;
  customer_id: string;
  event_type_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  venue_name: string | null;
  venue_address: string | null;
  status: EventStatus;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type ServiceRow = {
  id: string;
  business_id: string;
  event_id: string;
  source_service_id: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
type ReservationRow = {
  id: string;
  business_id: string;
  event_id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  price_cents: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
const fromType = (r: TypeRow): EventType => ({
  id: r.id,
  businessId: r.business_id,
  name: r.name,
  isActive: r.is_active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const fromResource = (r: ResourceRow): Resource => ({
  ...fromType(r),
  description: r.description,
  defaultPriceCents: r.default_price_cents,
});
const fromEvent = (r: EventRow): Event => ({
  id: r.id,
  businessId: r.business_id,
  branchId: r.branch_id,
  customerId: r.customer_id,
  eventTypeId: r.event_type_id,
  title: r.title,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  venueName: r.venue_name,
  venueAddress: r.venue_address,
  status: r.status,
  notes: r.notes,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const fromService = (r: ServiceRow): EventServiceItem => ({
  id: r.id,
  businessId: r.business_id,
  eventId: r.event_id,
  sourceServiceId: r.source_service_id,
  name: r.name,
  description: r.description,
  quantity: r.quantity,
  unitPriceCents: r.unit_price_cents,
  totalCents: r.total_cents,
  isActive: r.is_active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const fromReservation = (r: ReservationRow): ResourceReservation => ({
  id: r.id,
  businessId: r.business_id,
  eventId: r.event_id,
  resourceId: r.resource_id,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  priceCents: r.price_cents,
  notes: r.notes,
  isActive: r.is_active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const typeFields = (x: EventType) => ({ name: x.name, is_active: x.isActive });
const resourceFields = (x: Resource | ResourceDetails) => ({
  name: x.name,
  description: x.description,
  default_price_cents: x.defaultPriceCents,
});
const eventFields = (x: Event | EventDetails) => ({
  customer_id: x.customerId,
  event_type_id: x.eventTypeId,
  title: x.title,
  starts_at: x.startsAt,
  ends_at: x.endsAt,
  venue_name: x.venueName,
  venue_address: x.venueAddress,
  notes: x.notes,
});
const serviceFields = (x: EventServiceItem) => ({
  event_id: x.eventId,
  source_service_id: x.sourceServiceId,
  name: x.name,
  description: x.description,
  quantity: x.quantity,
  unit_price_cents: x.unitPriceCents,
  total_cents: x.totalCents,
  is_active: x.isActive,
});
const reservationFields = (x: ResourceReservation) => ({
  event_id: x.eventId,
  resource_id: x.resourceId,
  starts_at: x.startsAt,
  ends_at: x.endsAt,
  price_cents: x.priceCents,
  notes: x.notes,
  is_active: x.isActive,
});

export class SupabaseEventRepository implements EventRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}
  async listTypes(businessId: string, includeInactive = false) {
    let q = this.client
      .from('event_types')
      .select('*')
      .eq('business_id', businessId)
      .order('is_active', { ascending: false })
      .order('name');
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return (data as TypeRow[]).map(fromType);
  }
  async createType(type: EventType) {
    const { data, error } = await this.client
      .from('event_types')
      .insert({
        id: type.id,
        business_id: type.businessId,
        created_at: type.createdAt,
        ...typeFields(type),
      })
      .select('*')
      .single();
    if (error) throw error;
    return fromType(data as TypeRow);
  }
  async updateType(businessId: string, id: string, details: EventTypeDetails) {
    const { data, error } = await this.client
      .from('event_types')
      .update({ name: details.name })
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromType(data as TypeRow);
  }
  async setTypeActive(businessId: string, id: string, active: boolean) {
    const { data, error } = await this.client
      .from('event_types')
      .update({ is_active: active })
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromType(data as TypeRow);
  }
  async listResources(businessId: string, includeInactive = false) {
    let q = this.client
      .from('resources')
      .select('*')
      .eq('business_id', businessId)
      .order('is_active', { ascending: false })
      .order('name');
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return (data as ResourceRow[]).map(fromResource);
  }
  async getResource(businessId: string, id: string) {
    const { data, error } = await this.client
      .from('resources')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? fromResource(data as ResourceRow) : null;
  }
  async createResource(resource: Resource) {
    const { data, error } = await this.client
      .from('resources')
      .insert({
        id: resource.id,
        business_id: resource.businessId,
        created_at: resource.createdAt,
        is_active: resource.isActive,
        ...resourceFields(resource),
      })
      .select('*')
      .single();
    if (error) throw error;
    return fromResource(data as ResourceRow);
  }
  async updateResource(
    businessId: string,
    id: string,
    details: ResourceDetails,
  ) {
    const { data, error } = await this.client
      .from('resources')
      .update(resourceFields(details))
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromResource(data as ResourceRow);
  }
  async setResourceActive(businessId: string, id: string, active: boolean) {
    const { data, error } = await this.client
      .from('resources')
      .update({ is_active: active })
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromResource(data as ResourceRow);
  }
  async listEvents(query: EventListQuery) {
    let q = this.client
      .from('events')
      .select('*')
      .eq('business_id', query.businessId)
      .eq('branch_id', query.branchId)
      .order('starts_at')
      .limit(query.limit);
    if (query.from) q = q.gte('starts_at', query.from);
    if (query.to) q = q.lt('starts_at', query.to);
    if (query.statuses?.length) q = q.in('status', query.statuses);
    const { data, error } = await q;
    if (error) throw error;
    let rows = await this.summaries(
      query.businessId,
      (data as EventRow[]).map(fromEvent),
    );
    const term = query.query?.trim().toLocaleLowerCase('es-AR');
    if (term)
      rows = rows.filter(
        (x) =>
          x.title.toLocaleLowerCase('es-AR').includes(term) ||
          x.customerName.toLocaleLowerCase('es-AR').includes(term) ||
          (x.venueName ?? '').toLocaleLowerCase('es-AR').includes(term),
      );
    return rows;
  }
  async countUpcomingEvents(
    businessId: string,
    branchId: string,
    from: string,
  ) {
    const { count, error } = await this.client
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('branch_id', branchId)
      .eq('status', 'reserved')
      .gte('starts_at', from);
    if (error) throw error;
    return count ?? 0;
  }
  async getEventBundle(
    businessId: string,
    id: string,
  ): Promise<EventBundle | null> {
    const { data, error } = await this.client
      .from('events')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const [summary] = await this.summaries(businessId, [
      fromEvent(data as EventRow),
    ]);
    const [services, reservations] = await Promise.all([
      this.client
        .from('event_service_items')
        .select('*')
        .eq('business_id', businessId)
        .eq('event_id', id)
        .order('created_at'),
      this.client
        .from('resource_reservations')
        .select('*')
        .eq('business_id', businessId)
        .eq('event_id', id)
        .order('starts_at'),
    ]);
    if (services.error) throw services.error;
    if (reservations.error) throw reservations.error;
    const reservationSummaries = await this.enrichReservations(
      businessId,
      (reservations.data as ReservationRow[]).map(fromReservation),
      false,
    );
    return {
      event: summary,
      services: (services.data as ServiceRow[]).map(fromService),
      reservations: reservationSummaries,
    };
  }
  async createEvent(event: Event) {
    const { data, error } = await this.client
      .from('events')
      .insert({
        id: event.id,
        business_id: event.businessId,
        branch_id: event.branchId,
        status: event.status,
        created_by: event.createdBy,
        created_at: event.createdAt,
        ...eventFields(event),
      })
      .select('*')
      .single();
    if (error) throw error;
    return fromEvent(data as EventRow);
  }
  async updateEvent(businessId: string, id: string, details: EventDetails) {
    const { data, error } = await this.client
      .from('events')
      .update(eventFields(details))
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromEvent(data as EventRow);
  }
  async setEventStatus(businessId: string, id: string, status: EventStatus) {
    const { data, error } = await this.client
      .from('events')
      .update({ status })
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw this.friendlyConflict(error);
    return fromEvent(data as EventRow);
  }
  async upsertServiceItem(item: EventServiceItem) {
    const updated = await this.client
      .from('event_service_items')
      .update(serviceFields(item))
      .eq('business_id', item.businessId)
      .eq('id', item.id)
      .select('*')
      .maybeSingle();
    if (updated.error) throw updated.error;
    if (updated.data) return fromService(updated.data as ServiceRow);
    const { data, error } = await this.client
      .from('event_service_items')
      .insert({
        id: item.id,
        business_id: item.businessId,
        created_at: item.createdAt,
        ...serviceFields(item),
      })
      .select('*')
      .single();
    if (error) throw error;
    return fromService(data as ServiceRow);
  }
  async setServiceItemActive(businessId: string, id: string, active: boolean) {
    const { data, error } = await this.client
      .from('event_service_items')
      .update({ is_active: active })
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromService(data as ServiceRow);
  }
  async upsertReservation(item: ResourceReservation) {
    const updated = await this.client
      .from('resource_reservations')
      .update(reservationFields(item))
      .eq('business_id', item.businessId)
      .eq('id', item.id)
      .select('*')
      .maybeSingle();
    if (updated.error) throw this.friendlyConflict(updated.error);
    if (updated.data) return fromReservation(updated.data as ReservationRow);
    const { data, error } = await this.client
      .from('resource_reservations')
      .insert({
        id: item.id,
        business_id: item.businessId,
        created_at: item.createdAt,
        ...reservationFields(item),
      })
      .select('*')
      .single();
    if (error) throw this.friendlyConflict(error);
    return fromReservation(data as ReservationRow);
  }
  async setReservationActive(businessId: string, id: string, active: boolean) {
    const { data, error } = await this.client
      .from('resource_reservations')
      .update({ is_active: active })
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw this.friendlyConflict(error);
    return fromReservation(data as ReservationRow);
  }
  async listReservations(
    query: ResourceReservationQuery,
  ): Promise<ResourceReservationSummary[]> {
    let q = this.client
      .from('resource_reservations')
      .select('*')
      .eq('business_id', query.businessId)
      .eq('is_active', true)
      .lt('starts_at', query.to)
      .gt('ends_at', query.from)
      .order('starts_at');
    if (query.resourceId) q = q.eq('resource_id', query.resourceId);
    if (query.excludeReservationId) q = q.neq('id', query.excludeReservationId);
    const { data, error } = await q;
    if (error) throw error;
    const reservations = (data as ReservationRow[]).map(fromReservation);
    return this.enrichReservations(
      query.businessId,
      reservations,
      query.onlyBlocking !== false,
    );
  }
  private async enrichReservations(
    businessId: string,
    reservations: ResourceReservation[],
    onlyBlocking: boolean,
  ): Promise<ResourceReservationSummary[]> {
    if (!reservations.length) return [];
    const eventIds = [...new Set(reservations.map((x) => x.eventId))];
    const resourceIds = [...new Set(reservations.map((x) => x.resourceId))];
    const [events, resources] = await Promise.all([
      this.client
        .from('events')
        .select('id,title,status,customer_id')
        .eq('business_id', businessId)
        .in('id', eventIds),
      this.client
        .from('resources')
        .select('id,name')
        .eq('business_id', businessId)
        .in('id', resourceIds),
    ]);
    if (events.error) throw events.error;
    if (resources.error) throw resources.error;
    const eventRows = events.data as {
      id: string;
      title: string;
      status: EventStatus;
      customer_id: string;
    }[];
    const customerIds = [...new Set(eventRows.map((x) => x.customer_id))];
    const customers = await this.client
      .from('customers')
      .select('id,full_name')
      .eq('business_id', businessId)
      .in('id', customerIds);
    if (customers.error) throw customers.error;
    const eventMap = new Map(eventRows.map((x) => [x.id, x]));
    const resourceMap = new Map(
      (resources.data as { id: string; name: string }[]).map((x) => [
        x.id,
        x.name,
      ]),
    );
    const customerMap = new Map(
      (customers.data as { id: string; full_name: string }[]).map((x) => [
        x.id,
        x.full_name,
      ]),
    );
    return reservations.flatMap((r) => {
      const e = eventMap.get(r.eventId);
      if (!e || (onlyBlocking && !['reserved', 'completed'].includes(e.status)))
        return [];
      return [
        {
          ...r,
          resourceName: resourceMap.get(r.resourceId) ?? 'Recurso',
          eventTitle: e.title,
          eventStatus: e.status,
          customerName: customerMap.get(e.customer_id) ?? 'Cliente',
        },
      ];
    });
  }
  private friendlyConflict(error: { message?: string }) {
    return error.message?.includes('RESOURCE_RESERVATION_CONFLICT')
      ? new Error('El recurso no está disponible en ese horario.')
      : error;
  }
  private async summaries(
    businessId: string,
    events: Event[],
  ): Promise<EventSummary[]> {
    if (!events.length) return [];
    const eventIds = events.map((x) => x.id);
    const customerIds = [...new Set(events.map((x) => x.customerId))];
    const typeIds = [
      ...new Set(events.flatMap((x) => (x.eventTypeId ? [x.eventTypeId] : []))),
    ];
    const [c, t, s, r, resources] = await Promise.all([
      this.client
        .from('customers')
        .select('id,full_name,phone,email')
        .eq('business_id', businessId)
        .in('id', customerIds),
      typeIds.length
        ? this.client
            .from('event_types')
            .select('id,name')
            .eq('business_id', businessId)
            .in('id', typeIds)
        : Promise.resolve({ data: [], error: null }),
      this.client
        .from('event_service_items')
        .select('*')
        .eq('business_id', businessId)
        .in('event_id', eventIds)
        .eq('is_active', true),
      this.client
        .from('resource_reservations')
        .select('*')
        .eq('business_id', businessId)
        .in('event_id', eventIds)
        .eq('is_active', true),
      this.client
        .from('resources')
        .select('id,name')
        .eq('business_id', businessId),
    ]);
    for (const result of [c, t, s, r, resources])
      if (result.error) throw result.error;
    const cm = new Map(
      (
        c.data as {
          id: string;
          full_name: string;
          phone: string | null;
          email: string | null;
        }[]
      ).map((x) => [x.id, x]),
    );
    const tm = new Map(
      (t.data as { id: string; name: string }[]).map((x) => [x.id, x.name]),
    );
    const resourceMap = new Map(
      (resources.data as { id: string; name: string }[]).map((x) => [
        x.id,
        x.name,
      ]),
    );
    const services = (s.data as ServiceRow[]).map(fromService);
    const reservations = (r.data as ReservationRow[]).map(fromReservation);
    return events.map((event) => {
      const customer = cm.get(event.customerId);
      const ownServices = services.filter((x) => x.eventId === event.id);
      const ownReservations = reservations.filter(
        (x) => x.eventId === event.id,
      );
      const servicesSubtotalCents = ownServices.reduce(
        (sum, x) => sum + x.totalCents,
        0,
      );
      const resourcesSubtotalCents = ownReservations.reduce(
        (sum, x) => sum + x.priceCents,
        0,
      );
      return {
        ...event,
        customerName: customer?.full_name ?? 'Cliente',
        customerPhone: customer?.phone ?? null,
        customerEmail: customer?.email ?? null,
        eventTypeName: event.eventTypeId
          ? (tm.get(event.eventTypeId) ?? null)
          : null,
        serviceNames: ownServices.map((x) => x.name),
        resourceNames: ownReservations.map(
          (x) => resourceMap.get(x.resourceId) ?? 'Recurso',
        ),
        servicesSubtotalCents,
        resourcesSubtotalCents,
        totalCents: servicesSubtotalCents + resourcesSubtotalCents,
      };
    });
  }
}
