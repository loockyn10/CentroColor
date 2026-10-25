-- SERVICIOS-01: event offers and divisible LED capacity; Cloud remains authoritative on sync.
CREATE TABLE event_offers (
 id TEXT PRIMARY KEY NOT NULL,business_id TEXT NOT NULL,kind TEXT NOT NULL
 CHECK(kind IN('fabric_screen','led_screen','photo_booth','magic_mirror','spin_360')),
 name TEXT NOT NULL CHECK(length(trim(name))>0),width_mm INTEGER,height_mm INTEGER,
 projection TEXT CHECK(projection IS NULL OR projection IN('front','rear')),
 with_projector INTEGER NOT NULL CHECK(with_projector IN(0,1)),
 primary_resource_id TEXT,projector_resource_id TEXT,is_active INTEGER NOT NULL CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,sync_origin TEXT NOT NULL DEFAULT 'local',
 local_revision INTEGER NOT NULL DEFAULT 0,cloud_updated_at TEXT,UNIQUE(business_id,id),
 CHECK((width_mm IS NULL)=(height_mm IS NULL)),
 CHECK(width_mm IS NULL OR width_mm>0),CHECK(height_mm IS NULL OR height_mm>0),
 CHECK(kind='fabric_screen' OR (projection IS NULL AND with_projector=0 AND projector_resource_id IS NULL)),
 CHECK(kind<>'fabric_screen' OR (width_mm IS NOT NULL AND projection IS NOT NULL)),
 FOREIGN KEY(business_id,primary_resource_id) REFERENCES resources(business_id,id),
 FOREIGN KEY(business_id,projector_resource_id) REFERENCES resources(business_id,id)
);
CREATE TABLE event_offer_rates (
 id TEXT PRIMARY KEY NOT NULL,business_id TEXT NOT NULL,offer_id TEXT NOT NULL,
 price_list_id TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,sync_origin TEXT NOT NULL DEFAULT 'local',
 local_revision INTEGER NOT NULL DEFAULT 0,cloud_updated_at TEXT,UNIQUE(business_id,id),
 UNIQUE(business_id,offer_id,price_list_id),
 FOREIGN KEY(business_id,offer_id) REFERENCES event_offers(business_id,id),
 FOREIGN KEY(business_id,price_list_id) REFERENCES price_lists(business_id,id)
);
CREATE TABLE led_panel_pools (
 id TEXT PRIMARY KEY NOT NULL,business_id TEXT NOT NULL UNIQUE,
 total_panels INTEGER NOT NULL CHECK(total_panels>0),panel_area_mm2 INTEGER NOT NULL CHECK(panel_area_mm2>0),
 pixels_per_panel INTEGER NOT NULL CHECK(pixels_per_panel>0),is_active INTEGER NOT NULL CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,sync_origin TEXT NOT NULL DEFAULT 'local',
 local_revision INTEGER NOT NULL DEFAULT 0,cloud_updated_at TEXT
);
CREATE TABLE led_presets (
 id TEXT PRIMARY KEY NOT NULL,business_id TEXT NOT NULL,name TEXT NOT NULL,
 width_mm INTEGER NOT NULL CHECK(width_mm>0),height_mm INTEGER NOT NULL CHECK(height_mm>0),
 is_active INTEGER NOT NULL CHECK(is_active IN(0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 sync_origin TEXT NOT NULL DEFAULT 'local',local_revision INTEGER NOT NULL DEFAULT 0,cloud_updated_at TEXT,
 UNIQUE(business_id,id),UNIQUE(business_id,width_mm,height_mm)
);
CREATE TABLE led_controllers (
 id TEXT PRIMARY KEY NOT NULL,business_id TEXT NOT NULL,resource_id TEXT NOT NULL,
 max_pixels INTEGER CHECK(max_pixels IS NULL OR max_pixels>0),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,sync_origin TEXT NOT NULL DEFAULT 'local',
 local_revision INTEGER NOT NULL DEFAULT 0,cloud_updated_at TEXT,
 UNIQUE(business_id,id),UNIQUE(business_id,resource_id),
 FOREIGN KEY(business_id,resource_id) REFERENCES resources(business_id,id)
);
CREATE TABLE led_panel_reservations (
 id TEXT PRIMARY KEY NOT NULL,business_id TEXT NOT NULL,event_id TEXT NOT NULL,
 event_service_item_id TEXT NOT NULL,controller_resource_id TEXT NOT NULL,
 starts_at TEXT NOT NULL,ends_at TEXT NOT NULL CHECK(julianday(ends_at)>julianday(starts_at)),
 panels INTEGER NOT NULL CHECK(panels>0),is_active INTEGER NOT NULL CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,sync_origin TEXT NOT NULL DEFAULT 'local',
 local_revision INTEGER NOT NULL DEFAULT 0,cloud_updated_at TEXT,UNIQUE(business_id,id),
 FOREIGN KEY(business_id,event_id) REFERENCES events(business_id,id),
 FOREIGN KEY(business_id,event_service_item_id) REFERENCES event_service_items(business_id,id),
 FOREIGN KEY(business_id,controller_resource_id) REFERENCES led_controllers(business_id,resource_id)
);
CREATE INDEX led_panel_reservations_time_idx ON led_panel_reservations(business_id,starts_at,ends_at,id);
ALTER TABLE event_service_items ADD COLUMN price_list_id TEXT;
ALTER TABLE event_service_items ADD COLUMN config_snapshot TEXT;
CREATE TRIGGER event_item_catalog_ref_insert BEFORE INSERT ON event_service_items BEGIN
 SELECT CASE WHEN NEW.price_list_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM price_lists p
 WHERE p.business_id=NEW.business_id AND p.id=NEW.price_list_id) THEN RAISE(ABORT,'Lista ajena al negocio.') END;
 SELECT CASE WHEN NEW.config_snapshot IS NOT NULL AND NOT json_valid(NEW.config_snapshot)
 THEN RAISE(ABORT,'Snapshot inválido.') END;
END;
CREATE TRIGGER event_item_catalog_ref_update BEFORE UPDATE OF price_list_id,config_snapshot ON event_service_items BEGIN
 SELECT CASE WHEN NEW.price_list_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM price_lists p
 WHERE p.business_id=NEW.business_id AND p.id=NEW.price_list_id) THEN RAISE(ABORT,'Lista ajena al negocio.') END;
 SELECT CASE WHEN NEW.config_snapshot IS NOT NULL AND NOT json_valid(NEW.config_snapshot)
 THEN RAISE(ABORT,'Snapshot inválido.') END;
END;
CREATE TRIGGER led_item_ref_insert BEFORE INSERT ON led_panel_reservations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM event_service_items i WHERE i.business_id=NEW.business_id
 AND i.id=NEW.event_service_item_id AND i.event_id=NEW.event_id AND i.is_active=1
 AND json_extract(i.config_snapshot,'$.kind')='led_screen') THEN RAISE(ABORT,'LED_SERVICE_ITEM_REQUIRED') END;
END;
CREATE TRIGGER led_item_ref_update BEFORE UPDATE OF event_service_item_id,event_id ON led_panel_reservations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM event_service_items i WHERE i.business_id=NEW.business_id
 AND i.id=NEW.event_service_item_id AND i.event_id=NEW.event_id AND i.is_active=1
 AND json_extract(i.config_snapshot,'$.kind')='led_screen') THEN RAISE(ABORT,'LED_SERVICE_ITEM_REQUIRED') END;
END;
DROP TRIGGER event_service_item_local_update;
CREATE TRIGGER event_service_item_local_update AFTER UPDATE OF source_service_id,name,description,quantity,unit_price_cents,total_cents,is_active,price_list_id,config_snapshot ON event_service_items WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision) VALUES(lower(hex(randomblob(16))),NEW.business_id,'event_service_item',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,attempts=0,last_error=NULL,status='pending',conflict_kind=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;

CREATE TRIGGER led_reservation_insert_guard BEFORE INSERT ON led_panel_reservations
WHEN NEW.sync_origin='local' AND NEW.is_active=1 AND EXISTS(
 SELECT 1 FROM events e WHERE e.business_id=NEW.business_id AND e.id=NEW.event_id AND e.status IN('reserved','completed'))
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM event_service_items i WHERE i.business_id=NEW.business_id
 AND i.id=NEW.event_service_item_id AND i.event_id=NEW.event_id AND i.is_active=1
 AND json_extract(i.config_snapshot,'$.kind')='led_screen')
 THEN RAISE(ABORT,'LED_SERVICE_ITEM_REQUIRED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM led_panel_pools p WHERE p.business_id=NEW.business_id AND p.is_active=1)
 THEN RAISE(ABORT,'LED_POOL_NOT_CONFIGURED') END;
 SELECT CASE WHEN NEW.panels+(SELECT coalesce(sum(rr.panels),0) FROM led_panel_reservations rr
 JOIN events e ON e.business_id=rr.business_id AND e.id=rr.event_id
 WHERE rr.business_id=NEW.business_id AND rr.is_active=1
 AND (e.status IN('reserved','completed') OR rr.event_id=NEW.event_id)
 AND julianday(rr.starts_at)<julianday(NEW.ends_at) AND julianday(rr.ends_at)>julianday(NEW.starts_at))
 > (SELECT p.total_panels FROM led_panel_pools p WHERE p.business_id=NEW.business_id)
 THEN RAISE(ABORT,'LED_POOL_CAPACITY_CONFLICT') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM resource_reservations rr
 JOIN led_controllers c ON c.business_id=rr.business_id AND c.resource_id=rr.resource_id
 JOIN resources r ON r.business_id=c.business_id AND r.id=c.resource_id
 JOIN led_panel_pools p ON p.business_id=c.business_id
 WHERE rr.business_id=NEW.business_id AND rr.event_id=NEW.event_id AND rr.resource_id=NEW.controller_resource_id
 AND rr.is_active=1 AND r.is_active=1 AND c.max_pixels>=NEW.panels*p.pixels_per_panel
 AND julianday(rr.starts_at)<=julianday(NEW.starts_at) AND julianday(rr.ends_at)>=julianday(NEW.ends_at))
 THEN RAISE(ABORT,'LED_CONTROLLER_REQUIRED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM led_panel_reservations rr JOIN events e
 ON e.business_id=rr.business_id AND e.id=rr.event_id
 WHERE rr.business_id=NEW.business_id AND rr.is_active=1
 AND rr.controller_resource_id=NEW.controller_resource_id
 AND (rr.event_id=NEW.event_id OR e.status IN('reserved','completed'))
 AND julianday(rr.starts_at)<julianday(NEW.ends_at) AND julianday(rr.ends_at)>julianday(NEW.starts_at))
 THEN RAISE(ABORT,'LED_CONTROLLER_CONFLICT') END;
END;

CREATE TABLE event_service_outbox (
 id TEXT PRIMARY KEY NOT NULL,business_id TEXT NOT NULL,entity_type TEXT NOT NULL
 CHECK(entity_type IN('event_offer','event_offer_rate','led_panel_pool','led_preset','led_controller','led_panel_reservation')),
 entity_id TEXT NOT NULL,local_revision INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending'
 CHECK(status IN('pending','conflict')),attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,
 remote_updated_at TEXT,remote_snapshot TEXT,created_at TEXT NOT NULL,
 UNIQUE(business_id,entity_type,entity_id)
);
CREATE TABLE event_service_cursor (
 business_id TEXT NOT NULL,entity_type TEXT NOT NULL,updated_at TEXT NOT NULL,entity_id TEXT NOT NULL,
 PRIMARY KEY(business_id,entity_type)
);
CREATE TABLE event_led_sync_intents (
 business_id TEXT NOT NULL,event_id TEXT NOT NULL,target_status TEXT NOT NULL
 CHECK(target_status IN('reserved','completed')),
 PRIMARY KEY(business_id,event_id)
);
CREATE TRIGGER event_offer_outbox_insert AFTER INSERT ON event_offers WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO event_service_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'event_offer',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER event_offer_outbox_update AFTER UPDATE OF name,kind,width_mm,height_mm,projection,with_projector,primary_resource_id,projector_resource_id,is_active ON event_offers WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO event_service_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'event_offer',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER event_offer_rate_outbox_insert AFTER INSERT ON event_offer_rates WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO event_service_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'event_offer_rate',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER event_offer_rate_outbox_update AFTER UPDATE OF amount_cents ON event_offer_rates WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO event_service_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'event_offer_rate',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER led_panel_pool_outbox_insert AFTER INSERT ON led_panel_pools WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO event_service_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'led_panel_pool',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER led_panel_pool_outbox_update AFTER UPDATE OF total_panels,panel_area_mm2,pixels_per_panel,is_active ON led_panel_pools WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO event_service_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'led_panel_pool',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER led_preset_outbox_insert AFTER INSERT ON led_presets WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO event_service_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'led_preset',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER led_preset_outbox_update AFTER UPDATE OF name,width_mm,height_mm,is_active ON led_presets WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO event_service_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'led_preset',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER led_controller_outbox_insert AFTER INSERT ON led_controllers WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO event_service_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'led_controller',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER led_controller_outbox_update AFTER UPDATE OF resource_id,max_pixels ON led_controllers WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO event_service_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'led_controller',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER led_panel_reservation_outbox_insert AFTER INSERT ON led_panel_reservations WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO event_service_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'led_panel_reservation',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER led_panel_reservation_outbox_update AFTER UPDATE OF starts_at,ends_at,panels,controller_resource_id,is_active ON led_panel_reservations WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO event_service_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'led_panel_reservation',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER led_reservation_update_guard BEFORE UPDATE OF panels,starts_at,ends_at,is_active,controller_resource_id ON led_panel_reservations
WHEN NEW.sync_origin='local' AND NEW.is_active=1 AND EXISTS(
 SELECT 1 FROM events e WHERE e.business_id=NEW.business_id AND e.id=NEW.event_id AND e.status IN('reserved','completed'))
BEGIN
 SELECT CASE WHEN NEW.panels+(SELECT coalesce(sum(rr.panels),0) FROM led_panel_reservations rr
 JOIN events e ON e.business_id=rr.business_id AND e.id=rr.event_id
 WHERE rr.business_id=NEW.business_id AND rr.id<>NEW.id AND rr.is_active=1
 AND (e.status IN('reserved','completed') OR rr.event_id=NEW.event_id)
 AND julianday(rr.starts_at)<julianday(NEW.ends_at) AND julianday(rr.ends_at)>julianday(NEW.starts_at))
 > (SELECT p.total_panels FROM led_panel_pools p WHERE p.business_id=NEW.business_id AND p.is_active=1)
 THEN RAISE(ABORT,'LED_POOL_CAPACITY_CONFLICT') END;
END;
CREATE TRIGGER event_led_capacity_guard BEFORE UPDATE OF status ON events
WHEN NEW.sync_origin='local' AND NEW.status IN('reserved','completed') AND OLD.status NOT IN('reserved','completed')
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM event_service_items i WHERE i.business_id=NEW.business_id
 AND i.event_id=NEW.id AND i.is_active=1 AND json_extract(i.config_snapshot,'$.kind')='led_screen'
 AND NOT EXISTS(SELECT 1 FROM led_panel_reservations rr WHERE rr.business_id=i.business_id
 AND rr.event_id=i.event_id AND rr.event_service_item_id=i.id AND rr.is_active=1))
 THEN RAISE(ABORT,'LED_PANEL_RESERVATION_REQUIRED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM led_panel_reservations own
 JOIN led_panel_reservations other ON other.business_id=own.business_id
 AND other.id<>own.id AND other.controller_resource_id=own.controller_resource_id AND other.is_active=1
 JOIN events e ON e.business_id=other.business_id AND e.id=other.event_id
 WHERE own.business_id=NEW.business_id AND own.event_id=NEW.id AND own.is_active=1
 AND (other.event_id=NEW.id OR e.status IN('reserved','completed'))
 AND julianday(other.starts_at)<julianday(own.ends_at) AND julianday(other.ends_at)>julianday(own.starts_at))
 THEN RAISE(ABORT,'LED_CONTROLLER_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM led_panel_reservations own
 WHERE own.business_id=NEW.business_id AND own.event_id=NEW.id AND own.is_active=1
 AND (SELECT coalesce(sum(other.panels),0) FROM led_panel_reservations other
 JOIN events e ON e.business_id=other.business_id AND e.id=other.event_id
 WHERE other.business_id=own.business_id AND other.is_active=1
 AND (e.status IN('reserved','completed') OR other.event_id=NEW.id)
 AND julianday(other.starts_at)<julianday(own.ends_at) AND julianday(other.ends_at)>julianday(own.starts_at))
 > (SELECT total_panels FROM led_panel_pools WHERE business_id=NEW.business_id AND is_active=1))
 THEN RAISE(ABORT,'LED_POOL_CAPACITY_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM led_panel_reservations own
 WHERE own.business_id=NEW.business_id AND own.event_id=NEW.id AND own.is_active=1
 AND NOT EXISTS(SELECT 1 FROM resource_reservations rr
 JOIN led_controllers c ON c.business_id=rr.business_id AND c.resource_id=rr.resource_id
 JOIN resources r ON r.business_id=c.business_id AND r.id=c.resource_id
 JOIN led_panel_pools p ON p.business_id=c.business_id AND p.is_active=1
 WHERE rr.business_id=own.business_id AND rr.event_id=own.event_id AND rr.resource_id=own.controller_resource_id
 AND rr.is_active=1 AND r.is_active=1 AND c.max_pixels>=own.panels*p.pixels_per_panel
 AND julianday(rr.starts_at)<=julianday(own.starts_at) AND julianday(rr.ends_at)>=julianday(own.ends_at)))
 THEN RAISE(ABORT,'LED_CONTROLLER_REQUIRED') END;
END;
