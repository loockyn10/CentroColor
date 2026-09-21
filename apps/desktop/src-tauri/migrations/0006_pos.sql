-- IDs from a Cloud-validated offline context need not exist in legacy local identity tables.
CREATE TABLE product_categories (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (business_id, id),
  UNIQUE (business_id, name)
);
CREATE INDEX product_categories_business_name_idx ON product_categories(business_id, name);

CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  barcode TEXT CHECK (barcode IS NULL OR length(trim(barcode)) > 0),
  sale_price_cents INTEGER NOT NULL CHECK (sale_price_cents >= 0 AND sale_price_cents <= 9007199254740991),
  cost_price_cents INTEGER CHECK (cost_price_cents IS NULL OR (cost_price_cents >= 0 AND cost_price_cents <= 9007199254740991)),
  category_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, category_id) REFERENCES product_categories(business_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX products_business_barcode_unique ON products(business_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX products_business_active_name_idx ON products(business_id, is_active DESC, name COLLATE NOCASE, id);

CREATE TABLE sales (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  device_id TEXT,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'completed'),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0 AND subtotal_cents <= 9007199254740991),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0 AND total_cents = subtotal_cents),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'debit', 'credit', 'transfer', 'other')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (business_id, id)
);
CREATE INDEX sales_business_created_idx ON sales(business_id, created_at DESC, id);

CREATE TABLE sale_items (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  product_id TEXT,
  product_name TEXT NOT NULL CHECK (length(trim(product_name)) > 0),
  barcode TEXT,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0 AND unit_price_cents <= 9007199254740991),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0 AND total_cents = unit_price_cents * quantity),
  FOREIGN KEY (business_id, sale_id) REFERENCES sales(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE RESTRICT
);
CREATE INDEX sale_items_business_sale_idx ON sale_items(business_id, sale_id);
