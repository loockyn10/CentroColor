CREATE TABLE appointment_types (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  default_duration_minutes INTEGER NOT NULL CHECK (default_duration_minutes > 0 AND default_duration_minutes <= 1440),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local' CHECK (sync_origin IN ('local','remote')),
  local_revision INTEGER NOT NULL DEFAULT 0,
  cloud_updated_at TEXT,
  UNIQUE (business_id,id)
);
CREATE INDEX appointment_types_business_active_name_idx
  ON appointment_types(business_id,is_active DESC,name,id);

CREATE TABLE appointments (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  appointment_type_id TEXT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK (ends_at > starts_at),
  status TEXT NOT NULL CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local' CHECK (sync_origin IN ('local','remote')),
  local_revision INTEGER NOT NULL DEFAULT 0,
  cloud_updated_at TEXT,
  UNIQUE (business_id,id),
  FOREIGN KEY (business_id,appointment_type_id)
    REFERENCES appointment_types(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX appointments_business_branch_start_idx
  ON appointments(business_id,branch_id,starts_at,id);
CREATE INDEX appointments_business_branch_status_start_idx
  ON appointments(business_id,branch_id,status,starts_at,id);
CREATE INDEX appointments_business_customer_start_idx
  ON appointments(business_id,customer_id,starts_at,id);

CREATE TRIGGER appointments_business_refs_insert
BEFORE INSERT ON appointments BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM customers c WHERE c.business_id=NEW.business_id AND c.id=NEW.customer_id
  ) THEN RAISE(ABORT,'El cliente no pertenece al negocio.') END;
  SELECT CASE WHEN NEW.appointment_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM appointment_types t WHERE t.business_id=NEW.business_id AND t.id=NEW.appointment_type_id
  ) THEN RAISE(ABORT,'El tipo de turno no pertenece al negocio.') END;
END;
CREATE TRIGGER appointments_business_refs_update
BEFORE UPDATE OF customer_id,appointment_type_id ON appointments BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM customers c WHERE c.business_id=NEW.business_id AND c.id=NEW.customer_id
  ) THEN RAISE(ABORT,'El cliente no pertenece al negocio.') END;
  SELECT CASE WHEN NEW.appointment_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM appointment_types t WHERE t.business_id=NEW.business_id AND t.id=NEW.appointment_type_id
  ) THEN RAISE(ABORT,'El tipo de turno no pertenece al negocio.') END;
END;

CREATE TABLE appointment_sync_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('appointment_type','appointment')),
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  local_revision INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','conflict')),
  remote_updated_at TEXT,
  remote_snapshot TEXT,
  UNIQUE (business_id,entity_type,entity_id)
);
CREATE INDEX appointment_sync_outbox_order_idx
  ON appointment_sync_outbox(business_id,status,entity_type,created_at,id);
CREATE TABLE appointment_sync_cursor (
  business_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('appointment_type','appointment')),
  updated_at TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  last_success_at TEXT NOT NULL,
  PRIMARY KEY (business_id,entity_type)
);

CREATE TRIGGER appointment_type_local_insert AFTER INSERT ON appointment_types
WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO appointment_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'appointment_type',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
    local_revision=excluded.local_revision,attempts=0,last_error=NULL;
END;
CREATE TRIGGER appointment_type_local_update
AFTER UPDATE OF name,default_duration_minutes,is_active ON appointment_types
WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO appointment_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'appointment_type',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
    local_revision=excluded.local_revision,attempts=0,last_error=NULL;
END;
CREATE TRIGGER appointment_local_insert AFTER INSERT ON appointments
WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO appointment_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'appointment',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
    local_revision=excluded.local_revision,attempts=0,last_error=NULL;
END;
CREATE TRIGGER appointment_local_update
AFTER UPDATE OF customer_id,appointment_type_id,title,starts_at,ends_at,status,notes ON appointments
WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO appointment_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'appointment',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
    local_revision=excluded.local_revision,attempts=0,last_error=NULL;
END;
