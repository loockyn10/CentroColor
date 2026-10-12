CREATE TABLE event_types (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local' CHECK (sync_origin IN ('local','remote')),
  local_revision INTEGER NOT NULL DEFAULT 0,
  cloud_updated_at TEXT,
  UNIQUE (business_id,id)
);
CREATE INDEX event_types_business_active_name_idx ON event_types(business_id,is_active DESC,name,id);

CREATE TABLE resources (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  default_price_cents INTEGER CHECK (default_price_cents IS NULL OR default_price_cents >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local' CHECK (sync_origin IN ('local','remote')),
  local_revision INTEGER NOT NULL DEFAULT 0,
  cloud_updated_at TEXT,
  UNIQUE (business_id,id)
);
CREATE INDEX resources_business_active_name_idx ON resources(business_id,is_active DESC,name,id);

CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  event_type_id TEXT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK (julianday(ends_at) > julianday(starts_at)),
  venue_name TEXT,
  venue_address TEXT,
  status TEXT NOT NULL CHECK (status IN ('inquiry','quoted','reserved','completed','cancelled')),
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local' CHECK (sync_origin IN ('local','remote')),
  local_revision INTEGER NOT NULL DEFAULT 0,
  cloud_updated_at TEXT,
  UNIQUE (business_id,id),
  FOREIGN KEY (business_id,event_type_id) REFERENCES event_types(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX events_business_branch_start_idx ON events(business_id,branch_id,starts_at,id);
CREATE INDEX events_business_branch_status_start_idx ON events(business_id,branch_id,status,starts_at,id);
CREATE INDEX events_business_customer_start_idx ON events(business_id,customer_id,starts_at,id);

CREATE TRIGGER events_business_refs_insert BEFORE INSERT ON events BEGIN
  SELECT CASE WHEN NEW.sync_origin='local' AND NOT EXISTS (
    SELECT 1 FROM authorized_context a WHERE a.slot=1 AND a.business_id=NEW.business_id AND a.branch_id=NEW.branch_id AND a.user_id=NEW.created_by
  ) THEN RAISE(ABORT,'El evento no corresponde al contexto autorizado.') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM customers c WHERE c.business_id=NEW.business_id AND c.id=NEW.customer_id)
    THEN RAISE(ABORT,'El cliente no pertenece al negocio.') END;
  SELECT CASE WHEN NEW.event_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM event_types t WHERE t.business_id=NEW.business_id AND t.id=NEW.event_type_id)
    THEN RAISE(ABORT,'El tipo de evento no pertenece al negocio.') END;
END;
CREATE TRIGGER events_business_refs_update BEFORE UPDATE OF customer_id,event_type_id ON events BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM customers c WHERE c.business_id=NEW.business_id AND c.id=NEW.customer_id)
    THEN RAISE(ABORT,'El cliente no pertenece al negocio.') END;
  SELECT CASE WHEN NEW.event_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM event_types t WHERE t.business_id=NEW.business_id AND t.id=NEW.event_type_id)
    THEN RAISE(ABORT,'El tipo de evento no pertenece al negocio.') END;
END;

CREATE TABLE event_service_items (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  source_service_id TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0 AND total_cents = quantity * unit_price_cents),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local' CHECK (sync_origin IN ('local','remote')),
  local_revision INTEGER NOT NULL DEFAULT 0,
  cloud_updated_at TEXT,
  UNIQUE (business_id,id),
  FOREIGN KEY (business_id,event_id) REFERENCES events(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX event_service_items_event_idx ON event_service_items(business_id,event_id,is_active,id);

CREATE TABLE resource_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK (julianday(ends_at) > julianday(starts_at)),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local' CHECK (sync_origin IN ('local','remote')),
  local_revision INTEGER NOT NULL DEFAULT 0,
  cloud_updated_at TEXT,
  UNIQUE (business_id,id),
  FOREIGN KEY (business_id,event_id) REFERENCES events(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,resource_id) REFERENCES resources(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX resource_reservations_resource_time_idx ON resource_reservations(business_id,resource_id,starts_at,ends_at,id);
CREATE INDEX resource_reservations_event_idx ON resource_reservations(business_id,event_id,is_active,id);

CREATE TRIGGER resource_reservation_active_resource_insert BEFORE INSERT ON resource_reservations
WHEN NEW.sync_origin='local' AND NEW.is_active=1 BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM resources r WHERE r.business_id=NEW.business_id AND r.id=NEW.resource_id AND r.is_active=1)
    THEN RAISE(ABORT,'El recurso está inactivo o no pertenece al negocio.') END;
END;
CREATE TRIGGER resource_reservation_active_resource_update BEFORE UPDATE OF resource_id,is_active ON resource_reservations
WHEN NEW.sync_origin='local' AND NEW.is_active=1 BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM resources r WHERE r.business_id=NEW.business_id AND r.id=NEW.resource_id AND r.is_active=1)
    THEN RAISE(ABORT,'El recurso está inactivo o no pertenece al negocio.') END;
END;
CREATE TRIGGER resource_reservation_no_overlap_insert BEFORE INSERT ON resource_reservations
WHEN NEW.sync_origin='local' AND NEW.is_active=1 AND EXISTS (
  SELECT 1 FROM events e WHERE e.business_id=NEW.business_id AND e.id=NEW.event_id AND e.status IN ('reserved','completed')
) BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM resource_reservations rr JOIN events e ON e.business_id=rr.business_id AND e.id=rr.event_id
    WHERE rr.business_id=NEW.business_id AND rr.resource_id=NEW.resource_id AND rr.is_active=1
      AND e.status IN ('reserved','completed')
      AND julianday(rr.starts_at) < julianday(NEW.ends_at) AND julianday(rr.ends_at) > julianday(NEW.starts_at)
  ) THEN RAISE(ABORT,'El recurso no está disponible en ese horario.') END;
END;
CREATE TRIGGER resource_reservation_no_overlap_update BEFORE UPDATE OF resource_id,starts_at,ends_at,is_active ON resource_reservations
WHEN NEW.sync_origin='local' AND NEW.is_active=1 AND EXISTS (
  SELECT 1 FROM events e WHERE e.business_id=NEW.business_id AND e.id=NEW.event_id AND e.status IN ('reserved','completed')
) BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM resource_reservations rr JOIN events e ON e.business_id=rr.business_id AND e.id=rr.event_id
    WHERE rr.business_id=NEW.business_id AND rr.resource_id=NEW.resource_id AND rr.id<>NEW.id AND rr.is_active=1
      AND e.status IN ('reserved','completed')
      AND julianday(rr.starts_at) < julianday(NEW.ends_at) AND julianday(rr.ends_at) > julianday(NEW.starts_at)
  ) THEN RAISE(ABORT,'El recurso no está disponible en ese horario.') END;
END;
CREATE TRIGGER event_status_no_overlap BEFORE UPDATE OF status ON events
WHEN NEW.sync_origin='local' AND NEW.status IN ('reserved','completed') AND OLD.status NOT IN ('reserved','completed') BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM resource_reservations own
    JOIN resource_reservations other ON other.business_id=own.business_id AND other.resource_id=own.resource_id AND other.id<>own.id AND other.is_active=1
    JOIN events other_event ON other_event.business_id=other.business_id AND other_event.id=other.event_id
    WHERE own.business_id=NEW.business_id AND own.event_id=NEW.id AND own.is_active=1
      AND other_event.status IN ('reserved','completed')
      AND julianday(other.starts_at) < julianday(own.ends_at) AND julianday(other.ends_at) > julianday(own.starts_at)
  ) THEN RAISE(ABORT,'Un recurso del evento no está disponible en ese horario.') END;
END;

CREATE TABLE event_sync_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('event_type','resource','event','event_service_item','resource_reservation')),
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  local_revision INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','conflict')),
  conflict_kind TEXT CHECK (conflict_kind IS NULL OR conflict_kind IN ('version','availability')),
  remote_updated_at TEXT,
  remote_snapshot TEXT,
  UNIQUE (business_id,entity_type,entity_id)
);
CREATE INDEX event_sync_outbox_order_idx ON event_sync_outbox(business_id,status,entity_type,created_at,id);
CREATE TABLE event_sync_cursor (
  business_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('event_type','resource','event','event_service_item','resource_reservation')),
  updated_at TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  last_success_at TEXT NOT NULL,
  PRIMARY KEY (business_id,entity_type)
);

CREATE TRIGGER event_type_local_insert AFTER INSERT ON event_types WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision) VALUES(lower(hex(randomblob(16))),NEW.business_id,'event_type',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,attempts=0,last_error=NULL,status='pending',conflict_kind=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER event_type_local_update AFTER UPDATE OF name,is_active ON event_types WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision) VALUES(lower(hex(randomblob(16))),NEW.business_id,'event_type',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,attempts=0,last_error=NULL,status='pending',conflict_kind=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER resource_local_insert AFTER INSERT ON resources WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision) VALUES(lower(hex(randomblob(16))),NEW.business_id,'resource',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,attempts=0,last_error=NULL,status='pending',conflict_kind=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER resource_local_update AFTER UPDATE OF name,description,default_price_cents,is_active ON resources WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision) VALUES(lower(hex(randomblob(16))),NEW.business_id,'resource',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,attempts=0,last_error=NULL,status='pending',conflict_kind=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER event_local_insert AFTER INSERT ON events WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision) VALUES(lower(hex(randomblob(16))),NEW.business_id,'event',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,attempts=0,last_error=NULL,status='pending',conflict_kind=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER event_local_update AFTER UPDATE OF customer_id,event_type_id,title,starts_at,ends_at,venue_name,venue_address,status,notes ON events WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision) VALUES(lower(hex(randomblob(16))),NEW.business_id,'event',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,attempts=0,last_error=NULL,status='pending',conflict_kind=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER event_service_item_local_insert AFTER INSERT ON event_service_items WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision) VALUES(lower(hex(randomblob(16))),NEW.business_id,'event_service_item',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,attempts=0,last_error=NULL,status='pending',conflict_kind=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER event_service_item_local_update AFTER UPDATE OF source_service_id,name,description,quantity,unit_price_cents,total_cents,is_active ON event_service_items WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision) VALUES(lower(hex(randomblob(16))),NEW.business_id,'event_service_item',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,attempts=0,last_error=NULL,status='pending',conflict_kind=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER resource_reservation_local_insert AFTER INSERT ON resource_reservations WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision) VALUES(lower(hex(randomblob(16))),NEW.business_id,'resource_reservation',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,attempts=0,last_error=NULL,status='pending',conflict_kind=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER resource_reservation_local_update AFTER UPDATE OF resource_id,starts_at,ends_at,price_cents,notes,is_active ON resource_reservations WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision) VALUES(lower(hex(randomblob(16))),NEW.business_id,'resource_reservation',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,attempts=0,last_error=NULL,status='pending',conflict_kind=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
