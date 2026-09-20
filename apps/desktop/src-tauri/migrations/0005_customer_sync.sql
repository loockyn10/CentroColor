-- Customer writes and their outbox entry are committed by one SQLite statement.
ALTER TABLE customers ADD COLUMN sync_origin TEXT NOT NULL DEFAULT 'local'
  CHECK (sync_origin IN ('local', 'remote'));
ALTER TABLE customers ADD COLUMN local_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN cloud_updated_at TEXT;

CREATE TABLE sync_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type = 'customer'),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation = 'upsert'),
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'conflict')),
  local_revision INTEGER NOT NULL,
  remote_updated_at TEXT,
  remote_snapshot TEXT,
  UNIQUE (business_id, entity_type, entity_id)
);
CREATE INDEX sync_outbox_business_status_created_idx
  ON sync_outbox(business_id, status, created_at, id);

CREATE TABLE customer_sync_cursor (
  business_id TEXT PRIMARY KEY NOT NULL,
  updated_at TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  last_success_at TEXT NOT NULL
);

CREATE TRIGGER customer_local_insert_outbox
AFTER INSERT ON customers
WHEN NEW.sync_origin = 'local'
BEGIN
  INSERT INTO sync_outbox
    (id, business_id, entity_type, entity_id, operation, created_at, local_revision)
  VALUES
    (lower(hex(randomblob(16))), NEW.business_id, 'customer', NEW.id, 'upsert', NEW.updated_at, NEW.local_revision)
  ON CONFLICT (business_id, entity_type, entity_id) DO UPDATE SET
    local_revision = excluded.local_revision,
    attempts = 0,
    last_error = NULL,
    status = CASE WHEN sync_outbox.status = 'conflict' THEN 'conflict' ELSE 'pending' END;
END;

CREATE TRIGGER customer_local_update_outbox
AFTER UPDATE OF full_name, phone, email, document_number, notes, is_active ON customers
WHEN NEW.sync_origin = 'local'
BEGIN
  INSERT INTO sync_outbox
    (id, business_id, entity_type, entity_id, operation, created_at, local_revision)
  VALUES
    (lower(hex(randomblob(16))), NEW.business_id, 'customer', NEW.id, 'upsert', NEW.updated_at, NEW.local_revision)
  ON CONFLICT (business_id, entity_type, entity_id) DO UPDATE SET
    local_revision = excluded.local_revision,
    attempts = 0,
    last_error = NULL,
    status = CASE WHEN sync_outbox.status = 'conflict' THEN 'conflict' ELSE 'pending' END;
END;

-- Sprint 4 local records have never been pushed; retain every one for first sync.
INSERT INTO sync_outbox
  (id, business_id, entity_type, entity_id, operation, created_at, local_revision)
SELECT lower(hex(randomblob(16))), business_id, 'customer', id, 'upsert', updated_at, local_revision
FROM customers;
