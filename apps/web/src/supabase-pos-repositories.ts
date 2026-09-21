import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ProductRepository,
  SaleRepository,
} from '@centrocolor/application';
import { normalizeCategoryName } from '@centrocolor/domain';
import type {
  Product,
  ProductCategory,
  ProductDetails,
  Sale,
  SaleItem,
} from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';

type CategoryRow = {
  id: string;
  business_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
type ProductRow = CategoryRow & {
  barcode: string | null;
  sale_price_cents: number;
  cost_price_cents: number | null;
  category_id: string | null;
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
  business_id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  barcode: string | null;
  unit_price_cents: number;
  quantity: number;
  total_cents: number;
};
const categoryFromRow = (row: CategoryRow): ProductCategory => ({
  id: row.id,
  businessId: row.business_id,
  name: row.name,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const productFromRow = (row: ProductRow): Product => ({
  ...categoryFromRow(row),
  barcode: row.barcode,
  salePriceCents: row.sale_price_cents,
  costPriceCents: row.cost_price_cents,
  categoryId: row.category_id,
});
const saleFromRow = (row: SaleRow): Sale => ({
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
});
const itemFromRow = (row: ItemRow): SaleItem => ({
  id: row.id,
  saleId: row.sale_id,
  productId: row.product_id,
  productName: row.product_name,
  barcode: row.barcode,
  unitPriceCents: row.unit_price_cents,
  quantity: row.quantity,
  totalCents: row.total_cents,
  lineTotalCents: row.total_cents,
});
const fields = (details: ProductDetails) => ({
  name: details.name,
  barcode: details.barcode,
  sale_price_cents: details.salePriceCents,
  cost_price_cents: details.costPriceCents,
  category_id: details.categoryId,
});
const conflictMessage =
  'El registro cambió en Cloud. Recargá el catálogo antes de editarlo.';

export class SupabaseProductRepository implements ProductRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}
  async list(
    businessId: string,
    query: string,
    limit: number,
  ): Promise<Product[]> {
    const term = query.replace(/[%,()"\\]/g, '').trim();
    let request = this.client
      .from('products')
      .select('*')
      .eq('business_id', businessId);
    if (term)
      request = request.or(`name.ilike.%${term}%,barcode.ilike.%${term}%`);
    const { data, error } = await request
      .order('is_active', { ascending: false })
      .order('name')
      .limit(limit);
    if (error) throw error;
    return (data as ProductRow[]).map(productFromRow);
  }
  async findByBarcode(
    businessId: string,
    barcode: string,
  ): Promise<Product | null> {
    const { data, error } = await this.client
      .from('products')
      .select('*')
      .eq('business_id', businessId)
      .eq('barcode', barcode)
      .maybeSingle();
    if (error) throw error;
    return data ? productFromRow(data as ProductRow) : null;
  }
  async create(product: Product): Promise<Product> {
    const { data, error } = await this.client
      .from('products')
      .insert({
        id: product.id,
        business_id: product.businessId,
        ...fields(product),
        is_active: product.isActive,
        created_at: product.createdAt,
      })
      .select('*')
      .single();
    if (error) throw error;
    return productFromRow(data as ProductRow);
  }
  async update(
    businessId: string,
    id: string,
    details: ProductDetails,
    expectedUpdatedAt?: string,
  ): Promise<Product> {
    let request = this.client
      .from('products')
      .update(fields(details))
      .eq('business_id', businessId)
      .eq('id', id);
    if (expectedUpdatedAt)
      request = request.eq('updated_at', expectedUpdatedAt);
    const { data, error } = await request.select('*').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(conflictMessage);
    return productFromRow(data as ProductRow);
  }
  async setActive(
    businessId: string,
    id: string,
    active: boolean,
    expectedUpdatedAt?: string,
  ): Promise<Product> {
    let request = this.client
      .from('products')
      .update({ is_active: active })
      .eq('business_id', businessId)
      .eq('id', id);
    if (expectedUpdatedAt)
      request = request.eq('updated_at', expectedUpdatedAt);
    const { data, error } = await request.select('*').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(conflictMessage);
    return productFromRow(data as ProductRow);
  }
  async listCategories(businessId: string): Promise<ProductCategory[]> {
    const { data, error } = await this.client
      .from('product_categories')
      .select('*')
      .eq('business_id', businessId)
      .order('is_active', { ascending: false })
      .order('name');
    if (error) throw error;
    return (data as CategoryRow[]).map(categoryFromRow);
  }
  async createCategory(category: ProductCategory): Promise<ProductCategory> {
    const { data, error } = await this.client
      .from('product_categories')
      .insert({
        id: category.id,
        business_id: category.businessId,
        name: category.name,
        is_active: category.isActive,
        created_at: category.createdAt,
      })
      .select('*')
      .single();
    if (error) throw error;
    return categoryFromRow(data as CategoryRow);
  }
  async updateCategory(
    businessId: string,
    id: string,
    name: string,
    expectedUpdatedAt?: string,
  ): Promise<ProductCategory> {
    let request = this.client
      .from('product_categories')
      .update({ name: normalizeCategoryName(name) })
      .eq('business_id', businessId)
      .eq('id', id);
    if (expectedUpdatedAt)
      request = request.eq('updated_at', expectedUpdatedAt);
    const { data, error } = await request.select('*').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(conflictMessage);
    return categoryFromRow(data as CategoryRow);
  }
  async setCategoryActive(
    businessId: string,
    id: string,
    active: boolean,
    expectedUpdatedAt?: string,
  ): Promise<ProductCategory> {
    let request = this.client
      .from('product_categories')
      .update({ is_active: active })
      .eq('business_id', businessId)
      .eq('id', id);
    if (expectedUpdatedAt)
      request = request.eq('updated_at', expectedUpdatedAt);
    const { data, error } = await request.select('*').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(conflictMessage);
    return categoryFromRow(data as CategoryRow);
  }
}

export class SupabaseSaleRepository implements SaleRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}
  async complete(sale: Sale, items: SaleItem[]): Promise<void> {
    const { error } = await this.client.rpc('complete_pos_sale', {
      p_sale: {
        id: sale.id,
        business_id: sale.businessId,
        branch_id: sale.branchId,
        device_id: sale.deviceId,
        created_by: sale.createdBy,
        status: sale.status,
        subtotal_cents: sale.subtotalCents,
        total_cents: sale.totalCents,
        payment_method: sale.paymentMethod,
        created_at: sale.createdAt,
      },
      p_items: items.map((item) => ({
        id: item.id,
        sale_id: item.saleId,
        product_id: item.productId,
        product_name: item.productName,
        barcode: item.barcode,
        unit_price_cents: item.unitPriceCents,
        quantity: item.quantity,
        total_cents: item.totalCents,
      })),
    });
    if (error) throw error;
  }
  async list(businessId: string, limit: number): Promise<Sale[]> {
    const { data, error } = await this.client
      .from('sales')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data as SaleRow[]).map(saleFromRow);
  }
  async get(
    businessId: string,
    id: string,
  ): Promise<{ sale: Sale; items: SaleItem[] } | null> {
    const { data, error } = await this.client
      .from('sales')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const items: ItemRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const response = await this.client
        .from('sale_items')
        .select('*')
        .eq('business_id', businessId)
        .eq('sale_id', id)
        .order('id')
        .range(offset, offset + 999);
      if (response.error) throw response.error;
      items.push(...((response.data ?? []) as ItemRow[]));
      if (!response.data || response.data.length < 1000) break;
    }
    if (!items.length)
      throw new Error('La venta Cloud no tiene líneas completas.');
    return {
      sale: saleFromRow(data as SaleRow),
      items: items.map(itemFromRow),
    };
  }
}
