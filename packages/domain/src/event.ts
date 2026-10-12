import { requireCents } from './product';

export const eventStatuses = [
  'inquiry',
  'quoted',
  'reserved',
  'completed',
  'cancelled',
] as const;

export type EventStatus = (typeof eventStatuses)[number];

export interface EventType {
  id: string;
  businessId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  businessId: string;
  branchId: string;
  customerId: string;
  eventTypeId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  venueAddress: string | null;
  status: EventStatus;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventServiceItem {
  id: string;
  businessId: string;
  eventId: string;
  sourceServiceId: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Resource {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  defaultPriceCents: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceReservation {
  id: string;
  businessId: string;
  eventId: string;
  resourceId: string;
  startsAt: string;
  endsAt: string;
  priceCents: number;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type EventTypeDetails = Pick<EventType, 'name'>;
export type ResourceDetails = Pick<
  Resource,
  'name' | 'description' | 'defaultPriceCents'
>;
export type EventDetails = Pick<
  Event,
  | 'customerId'
  | 'eventTypeId'
  | 'title'
  | 'startsAt'
  | 'endsAt'
  | 'venueName'
  | 'venueAddress'
  | 'notes'
>;
export type EventServiceItemDetails = Pick<
  EventServiceItem,
  'sourceServiceId' | 'name' | 'description' | 'quantity' | 'unitPriceCents'
>;
export type ResourceReservationDetails = Pick<
  ResourceReservation,
  'resourceId' | 'startsAt' | 'endsAt' | 'priceCents' | 'notes'
>;

const cleanName = (value: string, message: string) => {
  const clean = value.trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error(message);
  return clean;
};

function normalizeInterval(startsAt: string, endsAt: string) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end))
    throw new Error('Ingresá una fecha y horario válidos.');
  if (end <= start)
    throw new Error('La hora de fin debe ser posterior al inicio.');
  return {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
  };
}

export function normalizeEventTypeDetails(
  details: EventTypeDetails,
): EventTypeDetails {
  return {
    name: cleanName(
      details.name,
      'El nombre del tipo de evento es obligatorio.',
    ),
  };
}

export function normalizeResourceDetails(
  details: ResourceDetails,
): ResourceDetails {
  return {
    name: cleanName(details.name, 'El nombre del recurso es obligatorio.'),
    description: details.description?.trim() || null,
    defaultPriceCents:
      details.defaultPriceCents === null
        ? null
        : requireCents(details.defaultPriceCents),
  };
}

export function normalizeEventDetails(details: EventDetails): EventDetails {
  if (!details.customerId.trim()) throw new Error('Seleccioná un cliente.');
  const interval = normalizeInterval(details.startsAt, details.endsAt);
  return {
    customerId: details.customerId.trim(),
    eventTypeId: details.eventTypeId?.trim() || null,
    title: cleanName(details.title, 'El título del evento es obligatorio.'),
    ...interval,
    venueName: details.venueName?.trim() || null,
    venueAddress: details.venueAddress?.trim() || null,
    notes: details.notes?.trim() || null,
  };
}

export function normalizeEventServiceItemDetails(
  details: EventServiceItemDetails,
): EventServiceItemDetails & { totalCents: number } {
  if (!Number.isInteger(details.quantity) || details.quantity <= 0)
    throw new Error('La cantidad del servicio debe ser mayor a cero.');
  const unitPriceCents = requireCents(details.unitPriceCents);
  const totalCents = unitPriceCents * details.quantity;
  if (!Number.isSafeInteger(totalCents))
    throw new Error('El total del servicio está fuera de rango.');
  return {
    sourceServiceId: details.sourceServiceId?.trim() || null,
    name: cleanName(details.name, 'El nombre del servicio es obligatorio.'),
    description: details.description?.trim() || null,
    quantity: details.quantity,
    unitPriceCents,
    totalCents,
  };
}

export function normalizeResourceReservationDetails(
  details: ResourceReservationDetails,
): ResourceReservationDetails {
  if (!details.resourceId.trim()) throw new Error('Seleccioná un recurso.');
  return {
    resourceId: details.resourceId.trim(),
    ...normalizeInterval(details.startsAt, details.endsAt),
    priceCents: requireCents(details.priceCents),
    notes: details.notes?.trim() || null,
  };
}

export function parseEventStatus(value: string): EventStatus {
  if ((eventStatuses as readonly string[]).includes(value))
    return value as EventStatus;
  throw new Error('Estado de evento inválido.');
}

export function eventStatusBlocksResources(status: EventStatus): boolean {
  return status === 'reserved' || status === 'completed';
}

export function reservationsOverlap(
  left: Pick<ResourceReservation, 'resourceId' | 'startsAt' | 'endsAt'>,
  right: Pick<ResourceReservation, 'resourceId' | 'startsAt' | 'endsAt'>,
): boolean {
  return (
    left.resourceId === right.resourceId &&
    Date.parse(left.startsAt) < Date.parse(right.endsAt) &&
    Date.parse(left.endsAt) > Date.parse(right.startsAt)
  );
}

export function eventTotals(
  services: EventServiceItem[],
  reservations: ResourceReservation[],
) {
  const servicesCents = services
    .filter((item) => item.isActive)
    .reduce((sum, item) => sum + item.totalCents, 0);
  const resourcesCents = reservations
    .filter((item) => item.isActive)
    .reduce((sum, item) => sum + item.priceCents, 0);
  const totalCents = servicesCents + resourcesCents;
  if (![servicesCents, resourcesCents, totalCents].every(Number.isSafeInteger))
    throw new Error('El total del evento está fuera de rango.');
  return { servicesCents, resourcesCents, totalCents };
}
