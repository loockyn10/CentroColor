-- Existing products and sale lines remain untracked. No historical sale backfill.
ALTER TABLE products ADD COLUMN tracks_inventory INTEGER NOT NULL DEFAULT 0 CHECK (tracks_inventory IN (0,1));
ALTER TABLE sale_items ADD COLUMN tracks_inventory INTEGER NOT NULL DEFAULT 0 CHECK (tracks_inventory IN (0,1));
CREATE UNIQUE INDEX sale_items_business_id_idx ON sale_items(business_id,id);
CREATE TRIGGER product_tracking_insert_guard BEFORE INSERT ON products
WHEN NEW.sync_origin='local' AND NEW.tracks_inventory=1 AND NOT EXISTS (
  SELECT 1 FROM authorized_context c WHERE c.slot=1 AND c.business_id=NEW.business_id
    AND c.role IN ('owner','admin'))
BEGIN SELECT RAISE(ABORT,'Solo owner/admin puede activar stock.'); END;
CREATE TRIGGER product_tracking_update_guard BEFORE UPDATE OF tracks_inventory ON products
WHEN NEW.sync_origin='local' AND NEW.tracks_inventory<>OLD.tracks_inventory AND NOT EXISTS (
  SELECT 1 FROM authorized_context c WHERE c.slot=1 AND c.business_id=NEW.business_id
    AND c.role IN ('owner','admin'))
BEGIN SELECT RAISE(ABORT,'Solo owner/admin puede cambiar stock.'); END;

CREATE TABLE inventory_balances (
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity BETWEEN -2147483648 AND 2147483647),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (business_id, branch_id, product_id),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE RESTRICT
);
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('initial','entry','adjustment','sale')),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0 AND quantity_delta BETWEEN -2147483648 AND 2147483647),
  sale_id TEXT,
  sale_item_id TEXT,
  note TEXT,
  created_by TEXT NOT NULL,
  device_id TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT,
  sync_origin TEXT NOT NULL CHECK (sync_origin IN ('local','remote')),
  CHECK ((movement_type = 'sale' AND sale_id IS NOT NULL AND sale_item_id IS NOT NULL AND quantity_delta < 0) OR
    (movement_type <> 'sale' AND sale_id IS NULL AND sale_item_id IS NULL)),
  CHECK (movement_type <> 'entry' OR quantity_delta > 0),
  UNIQUE (business_id, id),
  UNIQUE (sale_item_id),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, sale_id) REFERENCES sales(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, sale_item_id) REFERENCES sale_items(business_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX stock_initial_once_idx ON stock_movements(business_id,branch_id,product_id) WHERE movement_type='initial';
CREATE INDEX stock_movements_product_idx ON stock_movements(business_id,branch_id,product_id,occurred_at DESC,id DESC);
CREATE TABLE stock_sync_outbox (
  movement_id TEXT PRIMARY KEY NOT NULL REFERENCES stock_movements(id) ON DELETE RESTRICT,
  business_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX stock_sync_outbox_business_idx ON stock_sync_outbox(business_id,created_at,movement_id);
CREATE TABLE stock_sync_cursor (
  business_id TEXT PRIMARY KEY NOT NULL,
  received_at TEXT NOT NULL,
  movement_id TEXT NOT NULL
);
CREATE TRIGGER stock_movement_apply AFTER INSERT ON stock_movements BEGIN
  INSERT INTO inventory_balances(business_id,branch_id,product_id,quantity,updated_at)
  VALUES(NEW.business_id,NEW.branch_id,NEW.product_id,NEW.quantity_delta,NEW.occurred_at)
  ON CONFLICT(business_id,branch_id,product_id) DO UPDATE SET
    quantity=quantity+excluded.quantity,updated_at=excluded.updated_at;
  INSERT INTO stock_sync_outbox(movement_id,business_id,created_at)
  SELECT NEW.id,NEW.business_id,NEW.occurred_at WHERE NEW.sync_origin='local';
END;
CREATE TRIGGER stock_movement_immutable BEFORE UPDATE ON stock_movements
WHEN OLD.id <> NEW.id OR OLD.business_id <> NEW.business_id OR OLD.branch_id <> NEW.branch_id
  OR OLD.product_id <> NEW.product_id OR OLD.movement_type <> NEW.movement_type
  OR OLD.quantity_delta <> NEW.quantity_delta OR OLD.sale_id IS NOT NEW.sale_id
  OR OLD.sale_item_id IS NOT NEW.sale_item_id OR OLD.note IS NOT NEW.note
  OR OLD.created_by <> NEW.created_by OR OLD.device_id IS NOT NEW.device_id
  OR OLD.occurred_at <> NEW.occurred_at OR OLD.sync_origin <> NEW.sync_origin
BEGIN SELECT RAISE(ABORT,'El movimiento es inmutable.'); END;
CREATE TRIGGER stock_movement_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT,'El movimiento es inmutable.'); END;
CREATE TRIGGER sale_item_stock AFTER INSERT ON sale_items WHEN NEW.tracks_inventory=1 BEGIN
  INSERT OR IGNORE INTO stock_movements
  (id,business_id,branch_id,product_id,movement_type,quantity_delta,sale_id,sale_item_id,
   note,created_by,device_id,occurred_at,received_at,sync_origin)
  SELECT NEW.id,NEW.business_id,s.branch_id,NEW.product_id,'sale',-NEW.quantity,
    s.id,NEW.id,NULL,s.created_by,s.device_id,s.created_at,NULL,s.sync_origin
  FROM sales s WHERE s.id=NEW.sale_id AND s.business_id=NEW.business_id;
END;
CREATE TRIGGER pos_product_stock_update AFTER UPDATE OF tracks_inventory ON products
WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO pos_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'product',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
    local_revision=excluded.local_revision,attempts=0,last_error=NULL;
END;
