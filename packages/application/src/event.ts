import {
  normalizeEventDetails,
  normalizeEventServiceItemDetails,
  normalizeEventTypeDetails,
  normalizeResourceDetails,
  normalizeResourceReservationDetails,
  parseEventStatus,
  type Event,
  type EventDetails,
  type EventServiceItem,
  type EventServiceItemDetails,
  type EventStatus,
  type EventType,
  type EventTypeDetails,
  type Resource,
  type ResourceDetails,
  type ResourceReservation,
  type ResourceReservationDetails,
} from '@centrocolor/domain';

export interface EventSummary extends Event {
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  eventTypeName: string | null;
  serviceNames: string[];
  resourceNames: string[];
  servicesSubtotalCents: number;
  resourcesSubtotalCents: number;
  totalCents: number;
}

export interface ResourceReservationSummary extends ResourceReservation {
  resourceName: string;
  eventTitle: string;
  eventStatus: EventStatus;
  customerName: string;
}

export interface EventBundle {
  event: EventSummary;
  services: EventServiceItem[];
  reservations: ResourceReservationSummary[];
}

export interface EventListQuery {
  businessId: string;
  branchId: string;
  from?: string;
  to?: string;
  statuses?: EventStatus[];
  query?: string;
  limit: number;
}

export interface ResourceReservationQuery {
  businessId: string;
  from: string;
  to: string;
  resourceId?: string;
  excludeReservationId?: string;
  onlyBlocking?: boolean;
}

export interface EventRepository {
  listTypes(
    businessId: string,
    includeInactive?: boolean,
  ): Promise<EventType[]>;
  createType(type: EventType): Promise<EventType>;
  updateType(
    businessId: string,
    id: string,
    details: EventTypeDetails,
  ): Promise<EventType>;
  setTypeActive(
    businessId: string,
    id: string,
    active: boolean,
  ): Promise<EventType>;
  listResources(
    businessId: string,
    includeInactive?: boolean,
  ): Promise<Resource[]>;
  getResource(businessId: string, id: string): Promise<Resource | null>;
  createResource(resource: Resource): Promise<Resource>;
  updateResource(
    businessId: string,
    id: string,
    details: ResourceDetails,
  ): Promise<Resource>;
  setResourceActive(
    businessId: string,
    id: string,
    active: boolean,
  ): Promise<Resource>;
  listEvents(query: EventListQuery): Promise<EventSummary[]>;
  countUpcomingEvents(
    businessId: string,
    branchId: string,
    from: string,
  ): Promise<number>;
  getEventBundle(businessId: string, id: string): Promise<EventBundle | null>;
  createEvent(event: Event): Promise<Event>;
  updateEvent(
    businessId: string,
    id: string,
    details: EventDetails,
  ): Promise<Event>;
  setEventStatus(
    businessId: string,
    id: string,
    status: EventStatus,
  ): Promise<Event>;
  upsertServiceItem(item: EventServiceItem): Promise<EventServiceItem>;
  setServiceItemActive(
    businessId: string,
    id: string,
    active: boolean,
  ): Promise<EventServiceItem>;
  upsertReservation(
    reservation: ResourceReservation,
  ): Promise<ResourceReservation>;
  setReservationActive(
    businessId: string,
    id: string,
    active: boolean,
  ): Promise<ResourceReservation>;
  listReservations(
    query: ResourceReservationQuery,
  ): Promise<ResourceReservationSummary[]>;
}

export function createEventType(
  repository: EventRepository,
  businessId: string,
  details: EventTypeDetails,
  options: { id?: string; now?: string } = {},
) {
  const now = options.now ?? new Date().toISOString();
  return repository.createType({
    id: options.id ?? crypto.randomUUID(),
    businessId,
    ...normalizeEventTypeDetails(details),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

export function createResource(
  repository: EventRepository,
  businessId: string,
  details: ResourceDetails,
  options: { id?: string; now?: string } = {},
) {
  const now = options.now ?? new Date().toISOString();
  return repository.createResource({
    id: options.id ?? crypto.randomUUID(),
    businessId,
    ...normalizeResourceDetails(details),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

export function createEvent(
  repository: EventRepository,
  context: { businessId: string; branchId: string; userId: string },
  details: EventDetails,
  options: { id?: string; now?: string } = {},
) {
  const now = options.now ?? new Date().toISOString();
  return repository.createEvent({
    id: options.id ?? crypto.randomUUID(),
    businessId: context.businessId,
    branchId: context.branchId,
    ...normalizeEventDetails(details),
    status: 'inquiry',
    createdBy: context.userId,
    createdAt: now,
    updatedAt: now,
  });
}

export function createEventServiceItem(
  repository: EventRepository,
  context: { businessId: string; eventId: string },
  details: EventServiceItemDetails,
  options: { id?: string; now?: string } = {},
) {
  const now = options.now ?? new Date().toISOString();
  return repository.upsertServiceItem({
    id: options.id ?? crypto.randomUUID(),
    businessId: context.businessId,
    eventId: context.eventId,
    ...normalizeEventServiceItemDetails(details),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

export function createResourceReservation(
  repository: EventRepository,
  context: { businessId: string; eventId: string },
  details: ResourceReservationDetails,
  options: { id?: string; now?: string } = {},
) {
  const now = options.now ?? new Date().toISOString();
  return repository.upsertReservation({
    id: options.id ?? crypto.randomUUID(),
    businessId: context.businessId,
    eventId: context.eventId,
    ...normalizeResourceReservationDetails(details),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

export const updateEventType = (
  repository: EventRepository,
  businessId: string,
  id: string,
  details: EventTypeDetails,
) => repository.updateType(businessId, id, normalizeEventTypeDetails(details));
export const updateResource = (
  repository: EventRepository,
  businessId: string,
  id: string,
  details: ResourceDetails,
) =>
  repository.updateResource(businessId, id, normalizeResourceDetails(details));
export const updateEvent = (
  repository: EventRepository,
  businessId: string,
  id: string,
  details: EventDetails,
) => repository.updateEvent(businessId, id, normalizeEventDetails(details));
export const changeEventStatus = (
  repository: EventRepository,
  businessId: string,
  id: string,
  status: string,
) => repository.setEventStatus(businessId, id, parseEventStatus(status));
