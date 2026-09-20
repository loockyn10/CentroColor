CREATE TABLE authorized_context (
  slot INTEGER PRIMARY KEY NOT NULL CHECK (slot = 1),
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  business_id TEXT NOT NULL,
  business_name TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  last_cloud_validation_at TEXT NOT NULL
);
