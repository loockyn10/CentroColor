-- Sprint 14: public price list flags and the order channel. Desktop only mirrors them:
-- web orders are created in the Cloud, drafts never reach this device (Cloud RLS hides them)
-- and WhatsApp notices are queued by the Cloud when a job syncs as `ready`.
ALTER TABLE photo_services ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN(0,1));
ALTER TABLE photo_services ADD COLUMN public_name TEXT;
ALTER TABLE photo_services ADD COLUMN public_description TEXT;
ALTER TABLE photo_services ADD COLUMN public_sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photo_services ADD COLUMN public_order_enabled INTEGER NOT NULL DEFAULT 0 CHECK(public_order_enabled IN(0,1));
ALTER TABLE photo_jobs ADD COLUMN source_channel TEXT NOT NULL DEFAULT 'manual'
  CHECK(source_channel IN('manual','public_web','future_gmail'));

-- Editing a public flag locally must travel to the Cloud like any other service field.
DROP TRIGGER photo_service_outbox_update;
CREATE TRIGGER photo_service_outbox_update AFTER UPDATE OF code,name,service_type,width_mm,height_mm,default_unit_price_cents,workflow_route,requires_customer_files,is_public,public_name,public_description,public_sort_order,public_order_enabled,is_active ON photo_services WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO photo_sync_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'photo_service',NEW.id,NEW.updated_at,NEW.local_revision,0,NULL,'pending',NULL,NULL)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,created_at=excluded.created_at,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
