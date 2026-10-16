CREATE UNIQUE INDEX customers_business_id_id_photo_unique ON customers(business_id,id);
CREATE TABLE photo_services (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  code TEXT,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  service_type TEXT NOT NULL CHECK(service_type IN('print','enlargement','id_photo','editing','restoration','scanning','album','other')),
  width_mm INTEGER CHECK(width_mm IS NULL OR width_mm > 0),
  height_mm INTEGER CHECK(height_mm IS NULL OR height_mm > 0),
  default_unit_price_cents INTEGER NOT NULL CHECK(default_unit_price_cents >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local' CHECK(sync_origin IN('local','remote')),
  local_revision INTEGER NOT NULL DEFAULT 1,
  cloud_updated_at TEXT,
  UNIQUE(business_id,id),
  CHECK((width_mm IS NULL) = (height_mm IS NULL))
);
CREATE TABLE photo_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('received','in_progress','ready','delivered','cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN('normal','urgent')),
  promised_at TEXT,
  notes TEXT,
  source_appointment_id TEXT,
  source_event_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local' CHECK(sync_origin IN('local','remote')),
  local_revision INTEGER NOT NULL DEFAULT 1,
  cloud_updated_at TEXT,
  UNIQUE(business_id,id),
  FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,source_appointment_id) REFERENCES appointments(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,source_event_id) REFERENCES events(business_id,id) ON DELETE RESTRICT
);
CREATE TABLE photo_job_items (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  photo_job_id TEXT NOT NULL,
  photo_service_id TEXT,
  service_name_snapshot TEXT NOT NULL CHECK(length(trim(service_name_snapshot)) > 0),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
  total_cents INTEGER NOT NULL CHECK(total_cents = quantity * unit_price_cents),
  notes TEXT,
  width_mm INTEGER CHECK(width_mm IS NULL OR width_mm > 0),
  height_mm INTEGER CHECK(height_mm IS NULL OR height_mm > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local' CHECK(sync_origin IN('local','remote')),
  local_revision INTEGER NOT NULL DEFAULT 1,
  cloud_updated_at TEXT,
  UNIQUE(business_id,id),
  FOREIGN KEY(business_id,photo_job_id) REFERENCES photo_jobs(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,photo_service_id) REFERENCES photo_services(business_id,id) ON DELETE RESTRICT,
  CHECK((width_mm IS NULL) = (height_mm IS NULL))
);
CREATE INDEX photo_services_active_idx ON photo_services(business_id,is_active,name);
CREATE INDEX photo_services_sync_idx ON photo_services(business_id,updated_at,id);
CREATE INDEX photo_jobs_queue_idx ON photo_jobs(business_id,branch_id,status,priority,promised_at,created_at);
CREATE INDEX photo_jobs_customer_idx ON photo_jobs(business_id,customer_id,created_at DESC);
CREATE INDEX photo_jobs_sync_idx ON photo_jobs(business_id,updated_at,id);
CREATE INDEX photo_job_items_job_idx ON photo_job_items(business_id,photo_job_id,is_active,created_at);
CREATE INDEX photo_job_items_sync_idx ON photo_job_items(business_id,updated_at,id);
CREATE TRIGGER photo_jobs_business_refs_insert BEFORE INSERT ON photo_jobs BEGIN
  SELECT CASE WHEN NEW.sync_origin='local' AND NOT EXISTS (SELECT 1 FROM authorized_context a WHERE a.slot=1 AND a.business_id=NEW.business_id AND a.branch_id=NEW.branch_id AND a.user_id=NEW.created_by) THEN RAISE(ABORT,'El trabajo fotográfico no corresponde al contexto autorizado.') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM customers c WHERE c.business_id=NEW.business_id AND c.id=NEW.customer_id) THEN RAISE(ABORT,'El cliente no pertenece al negocio.') END;
  SELECT CASE WHEN NEW.source_appointment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.business_id=NEW.business_id AND a.id=NEW.source_appointment_id) THEN RAISE(ABORT,'El turno origen no pertenece al negocio.') END;
  SELECT CASE WHEN NEW.source_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM events e WHERE e.business_id=NEW.business_id AND e.id=NEW.source_event_id) THEN RAISE(ABORT,'El evento origen no pertenece al negocio.') END;
END;
CREATE TRIGGER photo_jobs_business_refs_update BEFORE UPDATE OF customer_id,source_appointment_id,source_event_id ON photo_jobs BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM customers c WHERE c.business_id=NEW.business_id AND c.id=NEW.customer_id) THEN RAISE(ABORT,'El cliente no pertenece al negocio.') END;
  SELECT CASE WHEN NEW.source_appointment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.business_id=NEW.business_id AND a.id=NEW.source_appointment_id) THEN RAISE(ABORT,'El turno origen no pertenece al negocio.') END;
  SELECT CASE WHEN NEW.source_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM events e WHERE e.business_id=NEW.business_id AND e.id=NEW.source_event_id) THEN RAISE(ABORT,'El evento origen no pertenece al negocio.') END;
END;
CREATE TABLE photo_sync_outbox (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN('photo_service','photo_job','photo_job_item')),
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  local_revision INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','conflict')),
  remote_updated_at TEXT,
  remote_snapshot TEXT,
  UNIQUE(business_id,entity_type,entity_id)
);
CREATE TABLE photo_sync_cursor (
  business_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN('photo_service','photo_job','photo_job_item')),
  updated_at TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  last_success_at TEXT NOT NULL,
  PRIMARY KEY(business_id,entity_type)
);
CREATE TRIGGER photo_service_outbox_insert AFTER INSERT ON photo_services WHEN NEW.sync_origin='local' BEGIN INSERT INTO photo_sync_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'photo_service',NEW.id,NEW.updated_at,NEW.local_revision,0,NULL,'pending',NULL,NULL) ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,created_at=excluded.created_at,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL; END;
CREATE TRIGGER photo_service_outbox_update AFTER UPDATE OF code,name,service_type,width_mm,height_mm,default_unit_price_cents,is_active ON photo_services WHEN NEW.sync_origin='local' BEGIN INSERT INTO photo_sync_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'photo_service',NEW.id,NEW.updated_at,NEW.local_revision,0,NULL,'pending',NULL,NULL) ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,created_at=excluded.created_at,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL; END;
CREATE TRIGGER photo_job_outbox_insert AFTER INSERT ON photo_jobs WHEN NEW.sync_origin='local' BEGIN INSERT INTO photo_sync_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'photo_job',NEW.id,NEW.updated_at,NEW.local_revision,0,NULL,'pending',NULL,NULL) ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,created_at=excluded.created_at,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL; END;
CREATE TRIGGER photo_job_outbox_update AFTER UPDATE OF customer_id,status,priority,promised_at,notes,source_appointment_id,source_event_id ON photo_jobs WHEN NEW.sync_origin='local' BEGIN INSERT INTO photo_sync_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'photo_job',NEW.id,NEW.updated_at,NEW.local_revision,0,NULL,'pending',NULL,NULL) ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,created_at=excluded.created_at,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL; END;
CREATE TRIGGER photo_item_outbox_insert AFTER INSERT ON photo_job_items WHEN NEW.sync_origin='local' BEGIN INSERT INTO photo_sync_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'photo_job_item',NEW.id,NEW.updated_at,NEW.local_revision,0,NULL,'pending',NULL,NULL) ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,created_at=excluded.created_at,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL; END;
CREATE TRIGGER photo_item_outbox_update AFTER UPDATE OF photo_service_id,service_name_snapshot,quantity,unit_price_cents,total_cents,notes,width_mm,height_mm,is_active ON photo_job_items WHEN NEW.sync_origin='local' BEGIN INSERT INTO photo_sync_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'photo_job_item',NEW.id,NEW.updated_at,NEW.local_revision,0,NULL,'pending',NULL,NULL) ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,created_at=excluded.created_at,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL; END;
