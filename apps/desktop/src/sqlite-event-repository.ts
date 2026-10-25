import Database from '@tauri-apps/plugin-sql';
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

const database = () => Database.load('sqlite:centrocolor.db');
type TypeRow = {
  id: string;
  business_id: string;
  name: string;
  is_active: number;
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
  customer_name?: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  event_type_name?: string | null;
  service_names?: string | null;
  resource_names?: string | null;
  services_subtotal_cents?: number;
  resources_subtotal_cents?: number;
};
type ServiceRow = {
  id: string;
  business_id: string;
  event_id: string;
  source_service_id: string | null;
  price_list_id?: string | null;
  config_snapshot?: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  is_active: number;
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
  is_active: number;
  created_at: string;
  updated_at: string;
  resource_name?: string;
  event_title?: string;
  event_status?: EventStatus;
  customer_name?: string;
};

const fromType = (row: TypeRow): EventType => ({
  id: row.id,
  businessId: row.business_id,
  name: row.name,
  isActive: row.is_active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const fromResource = (row: ResourceRow): Resource => ({
  ...fromType(row),
  description: row.description,
  defaultPriceCents: row.default_price_cents,
});
const fromEvent = (row: EventRow): Event => ({
  id: row.id,
  businessId: row.business_id,
  branchId: row.branch_id,
  customerId: row.customer_id,
  eventTypeId: row.event_type_id,
  title: row.title,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  venueName: row.venue_name,
  venueAddress: row.venue_address,
  status: row.status,
  notes: row.notes,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const fromService = (row: ServiceRow): EventServiceItem => ({
  id: row.id,
  businessId: row.business_id,
  eventId: row.event_id,
  sourceServiceId: row.source_service_id,
  priceListId: row.price_list_id ?? null,
  configSnapshot: row.config_snapshot
    ? (JSON.parse(row.config_snapshot) as Record<string, unknown>)
    : null,
  name: row.name,
  description: row.description,
  quantity: row.quantity,
  unitPriceCents: row.unit_price_cents,
  totalCents: row.total_cents,
  isActive: row.is_active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const fromReservation = (row: ReservationRow): ResourceReservation => ({
  id: row.id,
  businessId: row.business_id,
  eventId: row.event_id,
  resourceId: row.resource_id,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  priceCents: row.price_cents,
  notes: row.notes,
  isActive: row.is_active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const reservationSummary = (
  row: ReservationRow,
): ResourceReservationSummary => ({
  ...fromReservation(row),
  resourceName: row.resource_name ?? 'Recurso',
  eventTitle: row.event_title ?? 'Evento',
  eventStatus: row.event_status ?? 'inquiry',
  customerName: row.customer_name ?? 'Cliente',
});
const names = (value: string | null | undefined) =>
  value ? value.split('|||') : [];
const eventSummary = (row: EventRow): EventSummary => {
  const servicesSubtotalCents = row.services_subtotal_cents ?? 0;
  const resourcesSubtotalCents = row.resources_subtotal_cents ?? 0;
  return {
    ...fromEvent(row),
    customerName: row.customer_name ?? 'Cliente',
    customerPhone: row.customer_phone ?? null,
    customerEmail: row.customer_email ?? null,
    eventTypeName: row.event_type_name ?? null,
    serviceNames: names(row.service_names),
    resourceNames: names(row.resource_names),
    servicesSubtotalCents,
    resourcesSubtotalCents,
    totalCents: servicesSubtotalCents + resourcesSubtotalCents,
  };
};
const eventSelect = `SELECT e.*,c.full_name AS customer_name,c.phone AS customer_phone,c.email AS customer_email,t.name AS event_type_name,
  (SELECT group_concat(x.name,'|||') FROM event_service_items x WHERE x.business_id=e.business_id AND x.event_id=e.id AND x.is_active=1) AS service_names,
  (SELECT group_concat(r.name,'|||') FROM resource_reservations rr JOIN resources r ON r.business_id=rr.business_id AND r.id=rr.resource_id WHERE rr.business_id=e.business_id AND rr.event_id=e.id AND rr.is_active=1) AS resource_names,
  COALESCE((SELECT sum(x.total_cents) FROM event_service_items x WHERE x.business_id=e.business_id AND x.event_id=e.id AND x.is_active=1),0) AS services_subtotal_cents,
  COALESCE((SELECT sum(rr.price_cents) FROM resource_reservations rr WHERE rr.business_id=e.business_id AND rr.event_id=e.id AND rr.is_active=1),0) AS resources_subtotal_cents
  FROM events e JOIN customers c ON c.business_id=e.business_id AND c.id=e.customer_id LEFT JOIN event_types t ON t.business_id=e.business_id AND t.id=e.event_type_id`;

export class SQLiteEventRepository implements EventRepository {
  private async assertAdmin(businessId: string) {
    const db = await database();
    const rows = await db.select<{ ok: number }[]>(
      `SELECT count(*) AS ok FROM authorized_context WHERE slot=1 AND business_id=? AND role IN ('owner','admin')`,
      [businessId],
    );
    if (rows[0]?.ok !== 1)
      throw new Error('Solo owner/admin puede gestionar esta configuración.');
  }
  async listTypes(businessId: string, includeInactive = false) {
    const db = await database();
    return (
      await db.select<TypeRow[]>(
        `SELECT * FROM event_types WHERE business_id=? ${includeInactive ? '' : 'AND is_active=1'} ORDER BY is_active DESC,name COLLATE NOCASE,id`,
        [businessId],
      )
    ).map(fromType);
  }
  async createType(type: EventType) {
    await this.assertAdmin(type.businessId);
    const db = await database();
    await db.execute(
      `INSERT INTO event_types(id,business_id,name,is_active,created_at,updated_at,sync_origin,local_revision) VALUES(?,?,?,?,?,?,'local',1)`,
      [
        type.id,
        type.businessId,
        type.name,
        type.isActive ? 1 : 0,
        type.createdAt,
        type.updatedAt,
      ],
    );
    return type;
  }
  async updateType(businessId: string, id: string, details: EventTypeDetails) {
    await this.assertAdmin(businessId);
    const db = await database();
    const now = new Date().toISOString();
    const result = await db.execute(
      `UPDATE event_types SET name=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [details.name, now, businessId, id],
    );
    if (!result.rowsAffected)
      throw new Error('No se encontró el tipo de evento.');
    return (await this.listTypes(businessId, true)).find((x) => x.id === id)!;
  }
  async setTypeActive(businessId: string, id: string, active: boolean) {
    await this.assertAdmin(businessId);
    const db = await database();
    const result = await db.execute(
      `UPDATE event_types SET is_active=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [active ? 1 : 0, new Date().toISOString(), businessId, id],
    );
    if (!result.rowsAffected)
      throw new Error('No se encontró el tipo de evento.');
    return (await this.listTypes(businessId, true)).find((x) => x.id === id)!;
  }
  async listResources(businessId: string, includeInactive = false) {
    const db = await database();
    return (
      await db.select<ResourceRow[]>(
        `SELECT * FROM resources WHERE business_id=? ${includeInactive ? '' : 'AND is_active=1'} ORDER BY is_active DESC,name COLLATE NOCASE,id`,
        [businessId],
      )
    ).map(fromResource);
  }
  async getResource(businessId: string, id: string) {
    const db = await database();
    const rows = await db.select<ResourceRow[]>(
      `SELECT * FROM resources WHERE business_id=? AND id=?`,
      [businessId, id],
    );
    return rows[0] ? fromResource(rows[0]) : null;
  }
  async createResource(resource: Resource) {
    await this.assertAdmin(resource.businessId);
    const db = await database();
    await db.execute(
      `INSERT INTO resources(id,business_id,name,description,default_price_cents,is_active,created_at,updated_at,sync_origin,local_revision) VALUES(?,?,?,?,?,?,?,?,'local',1)`,
      [
        resource.id,
        resource.businessId,
        resource.name,
        resource.description,
        resource.defaultPriceCents,
        resource.isActive ? 1 : 0,
        resource.createdAt,
        resource.updatedAt,
      ],
    );
    return resource;
  }
  async updateResource(
    businessId: string,
    id: string,
    details: ResourceDetails,
  ) {
    await this.assertAdmin(businessId);
    const db = await database();
    const result = await db.execute(
      `UPDATE resources SET name=?,description=?,default_price_cents=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [
        details.name,
        details.description,
        details.defaultPriceCents,
        new Date().toISOString(),
        businessId,
        id,
      ],
    );
    if (!result.rowsAffected) throw new Error('No se encontró el recurso.');
    return (await this.getResource(businessId, id))!;
  }
  async setResourceActive(businessId: string, id: string, active: boolean) {
    await this.assertAdmin(businessId);
    const db = await database();
    const result = await db.execute(
      `UPDATE resources SET is_active=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [active ? 1 : 0, new Date().toISOString(), businessId, id],
    );
    if (!result.rowsAffected) throw new Error('No se encontró el recurso.');
    return (await this.getResource(businessId, id))!;
  }
  async listEvents(query: EventListQuery) {
    const db = await database();
    const clauses = ['e.business_id=?', 'e.branch_id=?'];
    const values: unknown[] = [query.businessId, query.branchId];
    if (query.from) {
      clauses.push('e.starts_at>=?');
      values.push(query.from);
    }
    if (query.to) {
      clauses.push('e.starts_at<?');
      values.push(query.to);
    }
    if (query.statuses?.length) {
      clauses.push(`e.status IN (${query.statuses.map(() => '?').join(',')})`);
      values.push(...query.statuses);
    }
    const term = query.query?.trim();
    if (term) {
      clauses.push(
        `(e.title LIKE ? ESCAPE '\\' OR c.full_name LIKE ? ESCAPE '\\' OR COALESCE(e.venue_name,'') LIKE ? ESCAPE '\\')`,
      );
      const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
      values.push(like, like, like);
    }
    values.push(query.limit);
    const rows = await db.select<EventRow[]>(
      `${eventSelect} WHERE ${clauses.join(' AND ')} ORDER BY e.starts_at,e.id LIMIT ?`,
      values,
    );
    return rows.map(eventSummary);
  }
  async countUpcomingEvents(
    businessId: string,
    branchId: string,
    from: string,
  ) {
    const db = await database();
    const rows = await db.select<{ count: number }[]>(
      `SELECT count(*) AS count FROM events WHERE business_id=? AND branch_id=? AND status='reserved' AND starts_at>=?`,
      [businessId, branchId, from],
    );
    return rows[0]?.count ?? 0;
  }
  async getEventBundle(
    businessId: string,
    id: string,
  ): Promise<EventBundle | null> {
    const db = await database();
    const events = await db.select<EventRow[]>(
      `${eventSelect} WHERE e.business_id=? AND e.id=?`,
      [businessId, id],
    );
    if (!events[0]) return null;
    const services = (
      await db.select<ServiceRow[]>(
        `SELECT * FROM event_service_items WHERE business_id=? AND event_id=? ORDER BY is_active DESC,created_at,id`,
        [businessId, id],
      )
    ).map(fromService);
    const reservations = (
      await db.select<ReservationRow[]>(
        `SELECT rr.*,r.name AS resource_name,e.title AS event_title,e.status AS event_status,c.full_name AS customer_name FROM resource_reservations rr JOIN resources r ON r.business_id=rr.business_id AND r.id=rr.resource_id JOIN events e ON e.business_id=rr.business_id AND e.id=rr.event_id JOIN customers c ON c.business_id=e.business_id AND c.id=e.customer_id WHERE rr.business_id=? AND rr.event_id=? ORDER BY rr.is_active DESC,rr.starts_at,rr.id`,
        [businessId, id],
      )
    ).map(reservationSummary);
    return { event: eventSummary(events[0]), services, reservations };
  }
  async createEvent(event: Event) {
    const db = await database();
    const allowed = await db.select<{ ok: number }[]>(
      `SELECT count(*) AS ok FROM authorized_context WHERE slot=1 AND business_id=? AND branch_id=? AND user_id=?`,
      [event.businessId, event.branchId, event.createdBy],
    );
    if (allowed[0]?.ok !== 1)
      throw new Error('El evento no corresponde al contexto autorizado.');
    await db.execute(
      `INSERT INTO events(id,business_id,branch_id,customer_id,event_type_id,title,starts_at,ends_at,venue_name,venue_address,status,notes,created_by,created_at,updated_at,sync_origin,local_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'local',1)`,
      [
        event.id,
        event.businessId,
        event.branchId,
        event.customerId,
        event.eventTypeId,
        event.title,
        event.startsAt,
        event.endsAt,
        event.venueName,
        event.venueAddress,
        event.status,
        event.notes,
        event.createdBy,
        event.createdAt,
        event.updatedAt,
      ],
    );
    return event;
  }
  async updateEvent(businessId: string, id: string, details: EventDetails) {
    const db = await database();
    const result = await db.execute(
      `UPDATE events SET customer_id=?,event_type_id=?,title=?,starts_at=?,ends_at=?,venue_name=?,venue_address=?,notes=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [
        details.customerId,
        details.eventTypeId,
        details.title,
        details.startsAt,
        details.endsAt,
        details.venueName,
        details.venueAddress,
        details.notes,
        new Date().toISOString(),
        businessId,
        id,
      ],
    );
    if (!result.rowsAffected) throw new Error('No se encontró el evento.');
    return (await this.getEventBundle(businessId, id))!.event;
  }
  async setEventStatus(businessId: string, id: string, status: EventStatus) {
    const db = await database();
    const result = await db.execute(
      `UPDATE events SET status=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [status, new Date().toISOString(), businessId, id],
    );
    if (!result.rowsAffected) throw new Error('No se encontró el evento.');
    return (await this.getEventBundle(businessId, id))!.event;
  }
  async upsertServiceItem(item: EventServiceItem) {
    const db = await database();
    await db.execute(
      `INSERT INTO event_service_items(id,business_id,event_id,source_service_id,name,description,quantity,unit_price_cents,total_cents,is_active,created_at,updated_at,price_list_id,config_snapshot,sync_origin,local_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'local',1) ON CONFLICT(id) DO UPDATE SET source_service_id=excluded.source_service_id,name=excluded.name,description=excluded.description,quantity=excluded.quantity,unit_price_cents=excluded.unit_price_cents,total_cents=excluded.total_cents,is_active=excluded.is_active,price_list_id=excluded.price_list_id,config_snapshot=excluded.config_snapshot,updated_at=excluded.updated_at,sync_origin='local',local_revision=event_service_items.local_revision+1 WHERE event_service_items.business_id=excluded.business_id AND event_service_items.event_id=excluded.event_id`,
      [
        item.id,
        item.businessId,
        item.eventId,
        item.sourceServiceId,
        item.name,
        item.description,
        item.quantity,
        item.unitPriceCents,
        item.totalCents,
        item.isActive ? 1 : 0,
        item.createdAt,
        item.updatedAt,
        item.priceListId ?? null,
        item.configSnapshot ? JSON.stringify(item.configSnapshot) : null,
      ],
    );
    return (await this.getEventBundle(
      item.businessId,
      item.eventId,
    ))!.services.find((x) => x.id === item.id)!;
  }
  async setServiceItemActive(businessId: string, id: string, active: boolean) {
    const db = await database();
    const result = await db.execute(
      `UPDATE event_service_items SET is_active=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [active ? 1 : 0, new Date().toISOString(), businessId, id],
    );
    if (!result.rowsAffected) throw new Error('No se encontró el servicio.');
    const rows = await db.select<ServiceRow[]>(
      `SELECT * FROM event_service_items WHERE business_id=? AND id=?`,
      [businessId, id],
    );
    return fromService(rows[0]);
  }
  async upsertReservation(item: ResourceReservation) {
    const db = await database();
    await db.execute(
      `INSERT INTO resource_reservations(id,business_id,event_id,resource_id,starts_at,ends_at,price_cents,notes,is_active,created_at,updated_at,sync_origin,local_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,'local',1) ON CONFLICT(id) DO UPDATE SET resource_id=excluded.resource_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,price_cents=excluded.price_cents,notes=excluded.notes,is_active=excluded.is_active,updated_at=excluded.updated_at,sync_origin='local',local_revision=resource_reservations.local_revision+1 WHERE resource_reservations.business_id=excluded.business_id AND resource_reservations.event_id=excluded.event_id`,
      [
        item.id,
        item.businessId,
        item.eventId,
        item.resourceId,
        item.startsAt,
        item.endsAt,
        item.priceCents,
        item.notes,
        item.isActive ? 1 : 0,
        item.createdAt,
        item.updatedAt,
      ],
    );
    const rows = await db.select<ReservationRow[]>(
      `SELECT * FROM resource_reservations WHERE business_id=? AND id=?`,
      [item.businessId, item.id],
    );
    return fromReservation(rows[0]);
  }
  async setReservationActive(businessId: string, id: string, active: boolean) {
    const db = await database();
    const result = await db.execute(
      `UPDATE resource_reservations SET is_active=?,updated_at=?,sync_origin='local',local_revision=local_revision+1 WHERE business_id=? AND id=?`,
      [active ? 1 : 0, new Date().toISOString(), businessId, id],
    );
    if (!result.rowsAffected) throw new Error('No se encontró la reserva.');
    const rows = await db.select<ReservationRow[]>(
      `SELECT * FROM resource_reservations WHERE business_id=? AND id=?`,
      [businessId, id],
    );
    return fromReservation(rows[0]);
  }
  async listReservations(query: ResourceReservationQuery) {
    const db = await database();
    const clauses = [
      `rr.business_id=?`,
      `rr.is_active=1`,
      `julianday(rr.starts_at)<julianday(?)`,
      `julianday(rr.ends_at)>julianday(?)`,
    ];
    const values: unknown[] = [query.businessId, query.to, query.from];
    if (query.resourceId) {
      clauses.push('rr.resource_id=?');
      values.push(query.resourceId);
    }
    if (query.excludeReservationId) {
      clauses.push('rr.id<>?');
      values.push(query.excludeReservationId);
    }
    if (query.onlyBlocking !== false)
      clauses.push(`e.status IN ('reserved','completed')`);
    const rows = await db.select<ReservationRow[]>(
      `SELECT rr.*,r.name AS resource_name,e.title AS event_title,e.status AS event_status,c.full_name AS customer_name FROM resource_reservations rr JOIN resources r ON r.business_id=rr.business_id AND r.id=rr.resource_id JOIN events e ON e.business_id=rr.business_id AND e.id=rr.event_id JOIN customers c ON c.business_id=e.business_id AND c.id=e.customer_id WHERE ${clauses.join(' AND ')} ORDER BY rr.starts_at,rr.id`,
      values,
    );
    return rows.map(reservationSummary);
  }
}
