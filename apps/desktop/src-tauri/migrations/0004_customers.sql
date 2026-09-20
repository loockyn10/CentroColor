-- The authorized Cloud business may not exist in legacy local businesses.
-- Application queries always scope by business_id.
CREATE TABLE customers (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  phone TEXT,
  email TEXT,
  document_number TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX customers_business_active_name_idx ON customers(business_id, is_active DESC, full_name, id);
CREATE INDEX customers_business_phone_idx ON customers(business_id, phone);
CREATE INDEX customers_business_email_idx ON customers(business_id, email);
CREATE INDEX customers_business_document_idx ON customers(business_id, document_number);
