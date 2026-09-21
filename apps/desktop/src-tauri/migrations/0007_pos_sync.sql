-- Customer outbox remains unchanged. POS owns its own queue and cursors.
ALTER TABLE product_categories ADD COLUMN sync_origin TEXT NOT NULL DEFAULT 'local' CHECK (sync_origin IN ('local', 'remote'));
ALTER TABLE product_categories ADD COLUMN local_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_categories ADD COLUMN cloud_updated_at TEXT;
ALTER TABLE products ADD COLUMN sync_origin TEXT NOT NULL DEFAULT 'local' CHECK (sync_origin IN ('local', 'remote'));
ALTER TABLE products ADD COLUMN local_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN cloud_updated_at TEXT;
ALTER TABLE sales ADD COLUMN sync_origin TEXT NOT NULL DEFAULT 'local' CHECK (sync_origin IN ('local', 'remote'));

CREATE TABLE pos_sync_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('category', 'product', 'sale')),
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  local_revision INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'conflict')),
  remote_updated_at TEXT,
  remote_snapshot TEXT,
  UNIQUE (business_id, entity_type, entity_id)
);
CREATE INDEX pos_sync_outbox_order_idx ON pos_sync_outbox(business_id, status, entity_type, created_at, id);
CREATE TABLE pos_sync_cursor (
  business_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('category', 'product', 'sale')),
  updated_at TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  last_success_at TEXT NOT NULL,
  PRIMARY KEY (business_id, entity_type)
);

CREATE TRIGGER pos_category_local_insert AFTER INSERT ON product_categories
WHEN NEW.sync_origin = 'local' BEGIN
  INSERT INTO pos_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'category',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
    local_revision=excluded.local_revision, attempts=0, last_error=NULL;
END;
CREATE TRIGGER pos_category_local_update AFTER UPDATE OF name,is_active ON product_categories
WHEN NEW.sync_origin = 'local' BEGIN
  INSERT INTO pos_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'category',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
    local_revision=excluded.local_revision, attempts=0, last_error=NULL;
END;
CREATE TRIGGER pos_product_local_insert AFTER INSERT ON products
WHEN NEW.sync_origin = 'local' BEGIN
  INSERT INTO pos_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'product',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
    local_revision=excluded.local_revision, attempts=0, last_error=NULL;
END;
CREATE TRIGGER pos_product_local_update AFTER UPDATE OF name,barcode,sale_price_cents,cost_price_cents,category_id,is_active ON products
WHEN NEW.sync_origin = 'local' BEGIN
  INSERT INTO pos_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'product',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
    local_revision=excluded.local_revision, attempts=0, last_error=NULL;
END;
CREATE TRIGGER pos_sale_local_insert AFTER INSERT ON sales
WHEN NEW.sync_origin = 'local' BEGIN
  INSERT INTO pos_sync_outbox(id,business_id,entity_type,entity_id,created_at)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'sale',NEW.id,NEW.created_at);
END;

-- All POS records predating the queue must be uploaded once.
INSERT INTO pos_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
SELECT lower(hex(randomblob(16))),business_id,'category',id,updated_at,local_revision FROM product_categories;
INSERT INTO pos_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
SELECT lower(hex(randomblob(16))),business_id,'product',id,updated_at,local_revision FROM products;
INSERT INTO pos_sync_outbox(id,business_id,entity_type,entity_id,created_at)
SELECT lower(hex(randomblob(16))),business_id,'sale',id,created_at FROM sales;
