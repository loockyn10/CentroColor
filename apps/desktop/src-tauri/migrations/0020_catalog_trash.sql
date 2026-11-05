-- Papelera de catálogos (gemela de supabase/migrations/20261105000000_catalog_trash.sql).
-- `deleted_at` no nulo = eliminado (reversible); distinto de `is_active`. La fila no se borra, por
-- lo que ventas, turnos, reservas y cotizaciones históricas conservan sus referencias.

ALTER TABLE product_categories ADD COLUMN deleted_at TEXT;
ALTER TABLE products ADD COLUMN deleted_at TEXT;
ALTER TABLE appointment_types ADD COLUMN deleted_at TEXT;
ALTER TABLE event_types ADD COLUMN deleted_at TEXT;
ALTER TABLE resources ADD COLUMN deleted_at TEXT;
ALTER TABLE frame_mouldings ADD COLUMN deleted_at TEXT;
ALTER TABLE frame_materials ADD COLUMN deleted_at TEXT;

-- El código de barras sólo es único entre productos que no están en la Papelera.
DROP INDEX products_business_barcode_unique;
CREATE UNIQUE INDEX products_business_barcode_unique ON products(business_id, barcode)
  WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX products_business_trash_idx ON products(business_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

-- Los triggers de salida (outbox) deben reaccionar a la eliminación/restauración: se recrean
-- con `deleted_at` entre las columnas vigiladas. Lo demás es idéntico a 0007/0009/0010/0012.
DROP TRIGGER pos_category_local_update;
CREATE TRIGGER pos_category_local_update AFTER UPDATE OF name,is_active,deleted_at ON product_categories
WHEN NEW.sync_origin = 'local' BEGIN
  INSERT INTO pos_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'category',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
    local_revision=excluded.local_revision, attempts=0, last_error=NULL;
END;

DROP TRIGGER pos_product_local_update;
CREATE TRIGGER pos_product_local_update AFTER UPDATE OF name,barcode,sale_price_cents,cost_price_cents,category_id,is_active,deleted_at ON products
WHEN NEW.sync_origin = 'local' BEGIN
  INSERT INTO pos_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'product',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
    local_revision=excluded.local_revision, attempts=0, last_error=NULL;
END;

DROP TRIGGER appointment_type_local_update;
CREATE TRIGGER appointment_type_local_update
AFTER UPDATE OF name,default_duration_minutes,is_active,deleted_at ON appointment_types
WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO appointment_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision)
  VALUES(lower(hex(randomblob(16))),NEW.business_id,'appointment_type',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
    local_revision=excluded.local_revision,attempts=0,last_error=NULL;
END;

DROP TRIGGER event_type_local_update;
CREATE TRIGGER event_type_local_update AFTER UPDATE OF name,is_active,deleted_at ON event_types WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision) VALUES(lower(hex(randomblob(16))),NEW.business_id,'event_type',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,attempts=0,last_error=NULL,status='pending',conflict_kind=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;

DROP TRIGGER resource_local_update;
CREATE TRIGGER resource_local_update AFTER UPDATE OF name,description,default_price_cents,is_active,deleted_at ON resources WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO event_sync_outbox(id,business_id,entity_type,entity_id,created_at,local_revision) VALUES(lower(hex(randomblob(16))),NEW.business_id,'resource',NEW.id,NEW.updated_at,NEW.local_revision)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,attempts=0,last_error=NULL,status='pending',conflict_kind=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;

DROP TRIGGER framing_moulding_outbox_update;
CREATE TRIGGER framing_moulding_outbox_update AFTER UPDATE OF code,name,description,face_width_mm,cost_per_meter_cents,sale_price_per_meter_cents,waste_percent,is_active,deleted_at ON frame_mouldings WHEN NEW.sync_origin='local' BEGIN INSERT INTO framing_sync_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'moulding',NEW.id,NEW.updated_at,NEW.local_revision,0,NULL,'pending',NULL,NULL) ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL; END;

DROP TRIGGER framing_material_outbox_update;
CREATE TRIGGER framing_material_outbox_update AFTER UPDATE OF name,material_type,pricing_unit,cost_cents,sale_price_cents,waste_percent,is_active,deleted_at ON frame_materials WHEN NEW.sync_origin='local' BEGIN INSERT INTO framing_sync_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'material',NEW.id,NEW.updated_at,NEW.local_revision,0,NULL,'pending',NULL,NULL) ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL; END;
