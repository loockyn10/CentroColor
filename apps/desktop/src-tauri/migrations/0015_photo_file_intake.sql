-- Sprint 13: operational file intake metadata. Photo binaries remain in Google Drive.
ALTER TABLE photo_services ADD COLUMN workflow_route TEXT NOT NULL DEFAULT 'none'
  CHECK(workflow_route IN('none','lab','editing','other'));
ALTER TABLE photo_services ADD COLUMN requires_customer_files INTEGER NOT NULL DEFAULT 0
  CHECK(requires_customer_files IN(0,1));
ALTER TABLE photo_jobs ADD COLUMN file_intake_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK(file_intake_status IN('not_required','not_requested','awaiting_files','receiving','submitted'));
ALTER TABLE photo_jobs ADD COLUMN drive_folder_id TEXT;
ALTER TABLE photo_jobs ADD COLUMN drive_edited_folder_id TEXT;

CREATE TABLE photo_job_files (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  photo_job_id TEXT NOT NULL,
  photo_job_item_id TEXT,
  drive_file_id TEXT NOT NULL,
  drive_folder_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  copies INTEGER NOT NULL DEFAULT 1 CHECK(copies > 0),
  workflow_route TEXT NOT NULL CHECK(workflow_route IN('none','lab','editing','other')),
  status TEXT NOT NULL CHECK(status IN('pending','uploading','uploaded','failed','removed')),
  uploaded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(business_id,id),
  UNIQUE(business_id,drive_file_id),
  FOREIGN KEY(business_id,photo_job_id) REFERENCES photo_jobs(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,photo_job_item_id) REFERENCES photo_job_items(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX photo_job_files_job_idx ON photo_job_files(business_id,photo_job_id,status,created_at);
CREATE INDEX photo_job_files_item_idx ON photo_job_files(business_id,photo_job_item_id,status);
CREATE TABLE photo_file_sync_cursor (
  business_id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  last_success_at TEXT NOT NULL
);

DROP TRIGGER photo_service_outbox_update;
CREATE TRIGGER photo_service_outbox_update AFTER UPDATE OF code,name,service_type,width_mm,height_mm,default_unit_price_cents,workflow_route,requires_customer_files,is_active ON photo_services WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO photo_sync_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'photo_service',NEW.id,NEW.updated_at,NEW.local_revision,0,NULL,'pending',NULL,NULL)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,created_at=excluded.created_at,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
DROP TRIGGER photo_job_outbox_update;
CREATE TRIGGER photo_job_outbox_update AFTER UPDATE OF customer_id,status,priority,promised_at,notes,source_appointment_id,source_event_id,file_intake_status,drive_folder_id,drive_edited_folder_id ON photo_jobs WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO photo_sync_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,'photo_job',NEW.id,NEW.updated_at,NEW.local_revision,0,NULL,'pending',NULL,NULL)
  ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET local_revision=excluded.local_revision,created_at=excluded.created_at,status='pending',attempts=0,last_error=NULL,remote_updated_at=NULL,remote_snapshot=NULL;
END;
