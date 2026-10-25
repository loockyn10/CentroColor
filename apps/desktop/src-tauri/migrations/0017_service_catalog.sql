-- SERVICIOS-01. Cloud seeds lists/materials/rates; UUIDs arrive through sync.
CREATE TABLE price_lists (
  id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>0),
  kind TEXT NOT NULL CHECK(kind IN('public','professional','custom')),
  is_default INTEGER NOT NULL CHECK(is_default IN(0,1)),
  is_active INTEGER NOT NULL CHECK(is_active IN(0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local', local_revision INTEGER NOT NULL DEFAULT 0,
  cloud_updated_at TEXT, UNIQUE(business_id,id),
  CHECK((kind='public')=is_default AND (is_default=0 OR is_active=1))
);
CREATE UNIQUE INDEX price_lists_default_idx ON price_lists(business_id) WHERE is_default=1;
ALTER TABLE customers ADD COLUMN price_list_id TEXT;
CREATE TRIGGER customer_price_list_ref_insert BEFORE INSERT ON customers
WHEN NEW.price_list_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM price_lists p WHERE p.business_id=NEW.business_id AND p.id=NEW.price_list_id)
BEGIN SELECT RAISE(ABORT,'Lista de precios ajena al negocio.'); END;
CREATE TRIGGER customer_price_list_ref_update BEFORE UPDATE OF price_list_id ON customers
WHEN NEW.price_list_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM price_lists p WHERE p.business_id=NEW.business_id AND p.id=NEW.price_list_id)
BEGIN SELECT RAISE(ABORT,'Lista de precios ajena al negocio.'); END;
DROP TRIGGER customer_local_update_outbox;
CREATE TRIGGER customer_local_update_outbox AFTER UPDATE OF
  full_name,phone,email,document_number,notes,is_active,price_list_id ON customers
WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO sync_outbox(id,business_id,entity_type,entity_id,operation,created_at,local_revision)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'customer',NEW.id,'upsert',NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
    local_revision=excluded.local_revision,attempts=0,last_error=NULL,
    status=CASE WHEN sync_outbox.status='conflict' THEN 'conflict' ELSE 'pending' END;
END;

CREATE TABLE lab_variants (
  id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL, photo_service_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN('laboratory','kiosk')),
  paper TEXT NOT NULL CHECK(paper IN('glossy','matte')),
  is_active INTEGER NOT NULL CHECK(is_active IN(0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local', local_revision INTEGER NOT NULL DEFAULT 0,
  cloud_updated_at TEXT, UNIQUE(business_id,id),
  UNIQUE(business_id,photo_service_id,channel,paper),
  FOREIGN KEY(business_id,photo_service_id) REFERENCES photo_services(business_id,id)
);
CREATE TABLE lab_price_tiers (
  id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL, variant_id TEXT NOT NULL,
  price_list_id TEXT NOT NULL, min_quantity INTEGER NOT NULL CHECK(min_quantity>0),
  max_quantity INTEGER CHECK(max_quantity IS NULL OR max_quantity>=min_quantity),
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local', local_revision INTEGER NOT NULL DEFAULT 0,
  cloud_updated_at TEXT, UNIQUE(business_id,id),
  UNIQUE(business_id,variant_id,price_list_id,min_quantity),
  FOREIGN KEY(business_id,variant_id) REFERENCES lab_variants(business_id,id),
  FOREIGN KEY(business_id,price_list_id) REFERENCES price_lists(business_id,id)
);
ALTER TABLE photo_job_items ADD COLUMN lab_variant_id TEXT;
ALTER TABLE photo_job_items ADD COLUMN price_list_id TEXT;
CREATE TRIGGER photo_item_catalog_refs_insert BEFORE INSERT ON photo_job_items BEGIN
 SELECT CASE WHEN NEW.lab_variant_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM lab_variants v WHERE v.business_id=NEW.business_id AND v.id=NEW.lab_variant_id)
 THEN RAISE(ABORT,'Variante ajena al negocio.') END;
 SELECT CASE WHEN NEW.price_list_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM price_lists p WHERE p.business_id=NEW.business_id AND p.id=NEW.price_list_id)
 THEN RAISE(ABORT,'Lista ajena al negocio.') END;
END;
CREATE TRIGGER photo_item_catalog_refs_update BEFORE UPDATE OF lab_variant_id,price_list_id ON photo_job_items BEGIN
 SELECT CASE WHEN NEW.lab_variant_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM lab_variants v WHERE v.business_id=NEW.business_id AND v.id=NEW.lab_variant_id)
 THEN RAISE(ABORT,'Variante ajena al negocio.') END;
 SELECT CASE WHEN NEW.price_list_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM price_lists p WHERE p.business_id=NEW.business_id AND p.id=NEW.price_list_id)
 THEN RAISE(ABORT,'Lista ajena al negocio.') END;
END;
CREATE TRIGGER lab_tiers_no_overlap_insert BEFORE INSERT ON lab_price_tiers
WHEN EXISTS(SELECT 1 FROM lab_price_tiers t WHERE t.business_id=NEW.business_id
  AND t.variant_id=NEW.variant_id AND t.price_list_id=NEW.price_list_id
  AND t.min_quantity<=coalesce(NEW.max_quantity,2147483647)
  AND NEW.min_quantity<=coalesce(t.max_quantity,2147483647))
BEGIN SELECT RAISE(ABORT,'LAB_TIER_OVERLAP'); END;
CREATE TRIGGER lab_tiers_no_overlap_update BEFORE UPDATE ON lab_price_tiers
WHEN EXISTS(SELECT 1 FROM lab_price_tiers t WHERE t.business_id=NEW.business_id
  AND t.variant_id=NEW.variant_id AND t.price_list_id=NEW.price_list_id AND t.id<>NEW.id
  AND t.min_quantity<=coalesce(NEW.max_quantity,2147483647)
  AND NEW.min_quantity<=coalesce(t.max_quantity,2147483647))
BEGIN SELECT RAISE(ABORT,'LAB_TIER_OVERLAP'); END;

CREATE TABLE plotter_materials (
  id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL, code TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>0),
  roll_width_mm INTEGER CHECK(roll_width_mm IS NULL OR roll_width_mm>0),
  is_active INTEGER NOT NULL CHECK(is_active IN(0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local', local_revision INTEGER NOT NULL DEFAULT 0,
  cloud_updated_at TEXT, UNIQUE(business_id,id), UNIQUE(business_id,code)
);
CREATE TABLE plotter_rates (
  id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL, price_list_id TEXT NOT NULL,
  code TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
  width_mm INTEGER CHECK(width_mm IS NULL OR width_mm>0),
  height_mm INTEGER CHECK(height_mm IS NULL OR height_mm>0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local', local_revision INTEGER NOT NULL DEFAULT 0,
  cloud_updated_at TEXT, UNIQUE(business_id,id),
  CHECK((width_mm IS NULL)=(height_mm IS NULL)),
  FOREIGN KEY(business_id,price_list_id) REFERENCES price_lists(business_id,id)
);
CREATE UNIQUE INDEX plotter_rates_unsized_idx ON plotter_rates(business_id,price_list_id,code)
WHERE width_mm IS NULL;
CREATE UNIQUE INDEX plotter_rates_sized_idx ON plotter_rates(business_id,price_list_id,code,width_mm,height_mm)
WHERE width_mm IS NOT NULL;
CREATE TABLE plotter_quotes (
  id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  customer_id TEXT, price_list_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('draft','quoted','accepted','cancelled','completed')),
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  total_cents INTEGER NOT NULL CHECK(total_cents>=0), notes TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local', local_revision INTEGER NOT NULL DEFAULT 0,
  cloud_updated_at TEXT, UNIQUE(business_id,id),
  FOREIGN KEY(business_id,price_list_id) REFERENCES price_lists(business_id,id),
  FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id)
);
CREATE INDEX plotter_quotes_business_idx ON plotter_quotes(business_id,branch_id,created_at);
CREATE TRIGGER plotter_quote_snapshot_immutable BEFORE UPDATE ON plotter_quotes
WHEN NEW.snapshot<>OLD.snapshot OR NEW.total_cents<>OLD.total_cents
  OR NEW.price_list_id<>OLD.price_list_id OR NEW.customer_id IS NOT OLD.customer_id
BEGIN SELECT RAISE(ABORT,'PLOTTER_SNAPSHOT_IMMUTABLE'); END;

CREATE TABLE service_catalog_outbox (
  id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN(
    'price_list','lab_variant','lab_price_tier','plotter_material','plotter_rate','plotter_quote')),
  entity_id TEXT NOT NULL, local_revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','conflict')),
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  remote_updated_at TEXT, remote_snapshot TEXT, created_at TEXT NOT NULL,
  UNIQUE(business_id,entity_type,entity_id)
);
CREATE INDEX service_catalog_outbox_pending_idx ON service_catalog_outbox(business_id,status,created_at,id);
CREATE TABLE service_catalog_cursor (
  business_id TEXT NOT NULL, entity_type TEXT NOT NULL,
  updated_at TEXT NOT NULL, entity_id TEXT NOT NULL,
  PRIMARY KEY(business_id,entity_type)
);

CREATE TRIGGER price_list_outbox_insert AFTER INSERT ON price_lists WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO service_catalog_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'price_list',NEW.id,NEW.local_revision,'pending',0,NULL,NULL,NULL,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER price_list_outbox_update AFTER UPDATE OF name,kind,is_default,is_active ON price_lists WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO service_catalog_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'price_list',NEW.id,NEW.local_revision,'pending',0,NULL,NULL,NULL,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER lab_variant_outbox_insert AFTER INSERT ON lab_variants WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO service_catalog_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'lab_variant',NEW.id,NEW.local_revision,'pending',0,NULL,NULL,NULL,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER lab_variant_outbox_update AFTER UPDATE OF photo_service_id,channel,paper,is_active ON lab_variants WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO service_catalog_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'lab_variant',NEW.id,NEW.local_revision,'pending',0,NULL,NULL,NULL,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER lab_tier_outbox_insert AFTER INSERT ON lab_price_tiers WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO service_catalog_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'lab_price_tier',NEW.id,NEW.local_revision,'pending',0,NULL,NULL,NULL,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER lab_tier_outbox_update AFTER UPDATE OF variant_id,price_list_id,min_quantity,max_quantity,unit_price_cents ON lab_price_tiers WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO service_catalog_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'lab_price_tier',NEW.id,NEW.local_revision,'pending',0,NULL,NULL,NULL,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER plotter_material_outbox_insert AFTER INSERT ON plotter_materials WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO service_catalog_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'plotter_material',NEW.id,NEW.local_revision,'pending',0,NULL,NULL,NULL,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER plotter_material_outbox_update AFTER UPDATE OF code,name,roll_width_mm,is_active ON plotter_materials WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO service_catalog_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'plotter_material',NEW.id,NEW.local_revision,'pending',0,NULL,NULL,NULL,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER plotter_rate_outbox_insert AFTER INSERT ON plotter_rates WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO service_catalog_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'plotter_rate',NEW.id,NEW.local_revision,'pending',0,NULL,NULL,NULL,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER plotter_rate_outbox_update AFTER UPDATE OF price_list_id,code,amount_cents,width_mm,height_mm ON plotter_rates WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO service_catalog_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'plotter_rate',NEW.id,NEW.local_revision,'pending',0,NULL,NULL,NULL,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER plotter_quote_outbox_insert AFTER INSERT ON plotter_quotes WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO service_catalog_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'plotter_quote',NEW.id,NEW.local_revision,'pending',0,NULL,NULL,NULL,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
CREATE TRIGGER plotter_quote_outbox_update AFTER UPDATE OF status ON plotter_quotes WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO service_catalog_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'plotter_quote',NEW.id,NEW.local_revision,'pending',0,NULL,NULL,NULL,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
