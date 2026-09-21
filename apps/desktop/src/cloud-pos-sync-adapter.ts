import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PendingPosChange,
  PosCursor,
  PosMutable,
  PosMutableType,
  PosSyncCloudPort,
  SaleBundle,
} from '@centrocolor/application';
import type {
  Product,
  ProductCategory,
  Sale,
  SaleItem,
} from '@centrocolor/domain';

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

export const categoryFromCloud = (row: CategoryRow): ProductCategory => ({
  id: row.id,
  businessId: row.business_id,
  name: row.name,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
export const productFromCloud = (row: ProductRow): Product => ({
  ...categoryFromCloud(row),
  barcode: row.barcode,
  salePriceCents: row.sale_price_cents,
  costPriceCents: row.cost_price_cents,
  categoryId: row.category_id,
});
export const saleFromCloud = (row: SaleRow): Sale => ({
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
export const itemFromCloud = (row: ItemRow): SaleItem => ({
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

function details(type: PosMutableType, entity: PosMutable) {
  if (type === 'category')
    return { name: entity.name, is_active: entity.isActive };
  const product = entity as Product;
  return {
    name: product.name,
    barcode: product.barcode,
    sale_price_cents: product.salePriceCents,
    cost_price_cents: product.costPriceCents,
    category_id: product.categoryId,
    is_active: product.isActive,
  };
}
function same(type: PosMutableType, a: PosMutable, b: PosMutable) {
  return (
    a.id === b.id &&
    a.businessId === b.businessId &&
    JSON.stringify(details(type, a)) === JSON.stringify(details(type, b))
  );
}
const table = (type: PosMutableType) =>
  type === 'category' ? 'product_categories' : 'products';
const decode = (type: PosMutableType, row: unknown): PosMutable =>
  type === 'category'
    ? categoryFromCloud(row as CategoryRow)
    : productFromCloud(row as ProductRow);

export class CloudPosSyncAdapter implements PosSyncCloudPort {
  constructor(private readonly client: SupabaseClient) {}

  async get(
    type: PosMutableType,
    businessId: string,
    id: string,
  ): Promise<PosMutable | null> {
    const { data, error } = await this.client
      .from(table(type))
      .select('*')
      .eq('business_id', businessId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? decode(type, data) : null;
  }

  async push(type: PosMutableType, change: PendingPosChange) {
    const { entity, cloudUpdatedAt } = change;
    if (cloudUpdatedAt === null) {
      const { data, error } = await this.client
        .from(table(type))
        .insert({
          id: entity.id,
          business_id: entity.businessId,
          created_at: entity.createdAt,
          ...details(type, entity),
        })
        .select('*')
        .single();
      if (!error)
        return { kind: 'pushed' as const, entity: decode(type, data) };
      if (error.code !== '23505') throw error;
    } else {
      const { data, error } = await this.client
        .from(table(type))
        .update(details(type, entity))
        .eq('business_id', entity.businessId)
        .eq('id', entity.id)
        .eq('updated_at', cloudUpdatedAt)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (data) return { kind: 'pushed' as const, entity: decode(type, data) };
    }
    const remote = await this.get(type, entity.businessId, entity.id);
    if (!remote)
      throw new Error(
        type === 'product'
          ? 'Ya existe otro producto Cloud con ese código de barras en este negocio.'
          : 'Ya existe otra categoría Cloud con ese nombre en este negocio.',
      );
    return {
      kind: same(type, remote, entity)
        ? ('pushed' as const)
        : ('conflict' as const),
      entity: remote,
    };
  }

  async pull(
    type: PosMutableType,
    businessId: string,
    after: PosCursor | null,
    limit: number,
  ): Promise<PosMutable[]> {
    let query = this.client
      .from(table(type))
      .select('*')
      .eq('business_id', businessId);
    if (after)
      query = query.or(
        `updated_at.gt.${after.updatedAt},and(updated_at.eq.${after.updatedAt},id.gt.${after.id})`,
      );
    const { data, error } = await query
      .order('updated_at')
      .order('id')
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => decode(type, row));
  }

  async pushSale({ sale, items }: SaleBundle): Promise<void> {
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

  async pullSales(
    businessId: string,
    after: PosCursor | null,
    limit: number,
  ): Promise<SaleBundle[]> {
    let query = this.client
      .from('sales')
      .select('*')
      .eq('business_id', businessId);
    if (after)
      query = query.or(
        `updated_at.gt.${after.updatedAt},and(updated_at.eq.${after.updatedAt},id.gt.${after.id})`,
      );
    const { data, error } = await query
      .order('updated_at')
      .order('id')
      .limit(limit);
    if (error) throw error;
    const rows = (data ?? []) as SaleRow[];
    if (!rows.length) return [];
    const allItems: ItemRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: itemData, error: itemError } = await this.client
        .from('sale_items')
        .select('*')
        .eq('business_id', businessId)
        .in(
          'sale_id',
          rows.map((row) => row.id),
        )
        .order('id')
        .range(offset, offset + 999);
      if (itemError) throw itemError;
      allItems.push(...((itemData ?? []) as ItemRow[]));
      if (!itemData || itemData.length < 1000) break;
    }
    return rows.map((row) => ({
      sale: saleFromCloud(row),
      items: allItems
        .filter((item) => item.sale_id === row.id)
        .map(itemFromCloud),
    }));
  }
}
