CREATE TABLE businesses (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE branches (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (business_id, name),
  UNIQUE (business_id, id)
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  device_type TEXT NOT NULL CHECK (device_type IN ('desktop', 'web', 'mobile')),
  installation_id TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (business_id, branch_id) REFERENCES branches(business_id, id) ON DELETE RESTRICT
);

CREATE INDEX branches_business_id_idx ON branches(business_id);
CREATE INDEX devices_business_branch_idx ON devices(business_id, branch_id);
