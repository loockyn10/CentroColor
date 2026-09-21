import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import type {
  ProductRepository,
  SaleRepository,
} from '@centrocolor/application';
import type {
  Product,
  ProductCategory,
  ProductDetails,
  Sale,
  SaleItem,
} from '@centrocolor/domain';
import { normalizeCategoryName } from '@centrocolor/domain';

const database = () => Database.load('sqlite:centrocolor.db');

type ProductRow = {
  id: string;
  business_id: string;
  name: string;
  barcode: string | null;
  sale_price_cents: number;
  cost_price_cents: number | null;
  category_id: string | null;
  is_active: number;
  tracks_inventory: number;
  created_at: string;
  updated_at: string;
};
type CategoryRow = {
  id: string;
  business_id: string;
  name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
};
type SaleRow = {
  id: string;
  business_id: string;
  branch_id: string;
  device_id: string | null;
  created_by: string;
  status: 'completed';
  subtotal_cents: number;
  total_cents: number;
  payment_method: Sale['paymentMethod'];
  created_at: string;
  updated_at: string;
};
type ItemRow = {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  barcode: string | null;
  unit_price_cents: number;
  quantity: number;
  total_cents: number;
  tracks_inventory: number;
};

function productFromRow(row: ProductRow): Product {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    barcode: row.barcode,
    salePriceCents: row.sale_price_cents,
    costPriceCents: row.cost_price_cents,
    categoryId: row.category_id,
    isActive: row.is_active === 1,
    tracksInventory: row.tracks_inventory === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function categoryFromRow(row: CategoryRow): ProductCategory {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function saleFromRow(row: SaleRow): Sale {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    deviceId: row.device_id,
    createdBy: row.created_by,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    totalCents: row.total_cents,
    paymentMethod: row.payment_method,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function itemFromRow(row: ItemRow): SaleItem {
  return {
    id: row.id,
    saleId: row.sale_id,
    productId: row.product_id,
    productName: row.product_name,
    barcode: row.barcode,
    unitPriceCents: row.unit_price_cents,
    quantity: row.quantity,
    lineTotalCents: row.total_cents,
    totalCents: row.total_cents,
    tracksInventory: row.tracks_inventory === 1,
  };
}

async function requireCategory(businessId: string, categoryId: string | null) {
  if (!categoryId) return;
  const db = await database();
  const rows = await db.select<{ id: string }[]>(
    'SELECT id FROM product_categories WHERE business_id = ? AND id = ?',
    [businessId, categoryId],
  );
  if (!rows.length) throw new Error('La categoría no pertenece al negocio.');
}

function productError(error: unknown): never {
  if (
    String(error).includes('products_business_barcode_unique') ||
    String(error).includes(
      'UNIQUE constraint failed: products.business_id, products.barcode',
    )
  )
    throw new Error(
      'Ya existe un producto con ese código de barras en este negocio.',
    );
  throw error;
}

export class SQLiteProductRepository implements ProductRepository {
  async list(
    businessId: string,
    query: string,
    limit: number,
  ): Promise<Product[]> {
    const db = await database();
    const term = `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await db.select<ProductRow[]>(
      `SELECT * FROM products WHERE business_id = ? AND
       (name LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\')
       ORDER BY is_active DESC, name COLLATE NOCASE, id LIMIT ?`,
      [businessId, term, term, limit],
    );
    return rows.map(productFromRow);
  }

  async findByBarcode(
    businessId: string,
    barcode: string,
  ): Promise<Product | null> {
    const db = await database();
    const rows = await db.select<ProductRow[]>(
      'SELECT * FROM products WHERE business_id = ? AND barcode = ? LIMIT 1',
      [businessId, barcode],
    );
    return rows[0] ? productFromRow(rows[0]) : null;
  }

  async get(businessId: string, id: string): Promise<Product | null> {
    const db = await database();
    const rows = await db.select<ProductRow[]>(
      'SELECT * FROM products WHERE business_id = ? AND id = ?',
      [businessId, id],
    );
    return rows[0] ? productFromRow(rows[0]) : null;
  }

  async create(product: Product): Promise<Product> {
    await requireCategory(product.businessId, product.categoryId);
    const db = await database();
    try {
      await db.execute(
        `INSERT INTO products (id, business_id, name, barcode, sale_price_cents,
         cost_price_cents, category_id, is_active, tracks_inventory, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          product.id,
          product.businessId,
          product.name,
          product.barcode,
          product.salePriceCents,
          product.costPriceCents,
          product.categoryId,
          product.isActive ? 1 : 0,
          product.tracksInventory ? 1 : 0,
          product.createdAt,
          product.updatedAt,
        ],
      );
    } catch (error) {
      productError(error);
    }
    return product;
  }

  async update(
    businessId: string,
    id: string,
    details: ProductDetails,
  ): Promise<Product> {
    await requireCategory(businessId, details.categoryId);
    const db = await database();
    try {
      const result = await db.execute(
        `UPDATE products SET name = ?, barcode = ?, sale_price_cents = ?,
         cost_price_cents = ?, category_id = ?, tracks_inventory = ?, updated_at = ?,
         sync_origin = 'local', local_revision = local_revision + 1
         WHERE business_id = ? AND id = ?`,
        [
          details.name,
          details.barcode,
          details.salePriceCents,
          details.costPriceCents,
          details.categoryId,
          details.tracksInventory ? 1 : 0,
          new Date().toISOString(),
          businessId,
          id,
        ],
      );
      if (!result.rowsAffected) throw new Error('No se encontró el producto.');
    } catch (error) {
      productError(error);
    }
    return (await this.get(businessId, id))!;
  }

  async setActive(
    businessId: string,
    id: string,
    active: boolean,
  ): Promise<Product> {
    const db = await database();
    const result = await db.execute(
      "UPDATE products SET is_active = ?, updated_at = ?, sync_origin = 'local', local_revision = local_revision + 1 WHERE business_id = ? AND id = ?",
      [active ? 1 : 0, new Date().toISOString(), businessId, id],
    );
    if (!result.rowsAffected) throw new Error('No se encontró el producto.');
    return (await this.get(businessId, id))!;
  }

  async listCategories(businessId: string): Promise<ProductCategory[]> {
    const db = await database();
    const rows = await db.select<CategoryRow[]>(
      'SELECT * FROM product_categories WHERE business_id = ? ORDER BY is_active DESC, name COLLATE NOCASE',
      [businessId],
    );
    return rows.map(categoryFromRow);
  }

  async createCategory(category: ProductCategory): Promise<ProductCategory> {
    const db = await database();
    await db.execute(
      'INSERT INTO product_categories (id, business_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        category.id,
        category.businessId,
        category.name,
        1,
        category.createdAt,
        category.updatedAt,
      ],
    );
    return category;
  }

  async updateCategory(
    businessId: string,
    id: string,
    name: string,
  ): Promise<ProductCategory> {
    const db = await database();
    const result = await db.execute(
      "UPDATE product_categories SET name = ?, updated_at = ?, sync_origin = 'local', local_revision = local_revision + 1 WHERE business_id = ? AND id = ?",
      [normalizeCategoryName(name), new Date().toISOString(), businessId, id],
    );
    if (!result.rowsAffected) throw new Error('No se encontró la categoría.');
    return (await this.getCategory(businessId, id))!;
  }

  async setCategoryActive(
    businessId: string,
    id: string,
    active: boolean,
  ): Promise<ProductCategory> {
    const db = await database();
    const result = await db.execute(
      "UPDATE product_categories SET is_active = ?, updated_at = ?, sync_origin = 'local', local_revision = local_revision + 1 WHERE business_id = ? AND id = ?",
      [active ? 1 : 0, new Date().toISOString(), businessId, id],
    );
    if (!result.rowsAffected) throw new Error('No se encontró la categoría.');
    return (await this.getCategory(businessId, id))!;
  }

  private async getCategory(
    businessId: string,
    id: string,
  ): Promise<ProductCategory | null> {
    const db = await database();
    const rows = await db.select<CategoryRow[]>(
      'SELECT * FROM product_categories WHERE business_id = ? AND id = ?',
      [businessId, id],
    );
    return rows[0] ? categoryFromRow(rows[0]) : null;
  }
}

export class SQLiteSaleRepository implements SaleRepository {
  async complete(sale: Sale, items: SaleItem[]): Promise<void> {
    await invoke('complete_local_sale', { sale, items });
  }

  async list(businessId: string, limit: number): Promise<Sale[]> {
    const db = await database();
    const rows = await db.select<SaleRow[]>(
      'SELECT * FROM sales WHERE business_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      [businessId, limit],
    );
    return rows.map(saleFromRow);
  }

  async get(
    businessId: string,
    id: string,
  ): Promise<{ sale: Sale; items: SaleItem[] } | null> {
    const db = await database();
    const sales = await db.select<SaleRow[]>(
      'SELECT * FROM sales WHERE business_id = ? AND id = ?',
      [businessId, id],
    );
    if (!sales[0]) return null;
    const items = await db.select<ItemRow[]>(
      'SELECT * FROM sale_items WHERE business_id = ? AND sale_id = ? ORDER BY rowid',
      [businessId, id],
    );
    return { sale: saleFromRow(sales[0]), items: items.map(itemFromRow) };
  }
}
