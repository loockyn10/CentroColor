import type { SupabaseClient } from '@supabase/supabase-js';
import type { InventoryRepository } from '@centrocolor/application';
import type {
  InventoryBalance,
  StockMovement,
  StockMovementType,
} from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';

type BalanceRow = {
  business_id: string;
  branch_id: string;
  product_id: string;
  quantity: number;
  updated_at: string;
};
type MovementRow = {
  id: string;
  business_id: string;
  branch_id: string;
  product_id: string;
  movement_type: StockMovementType;
  quantity_delta: number;
  sale_id: string | null;
  sale_item_id: string | null;
  note: string | null;
  created_by: string;
  device_id: string | null;
  occurred_at: string;
  received_at: string;
};

export class SupabaseInventoryRepository implements InventoryRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}
  async balances(
    businessId: string,
    branchId: string,
    productIds: string[],
  ): Promise<InventoryBalance[]> {
    if (!productIds.length) return [];
    const { data, error } = await this.client
      .from('inventory_balances')
      .select('*')
      .eq('business_id', businessId)
      .eq('branch_id', branchId)
      .in('product_id', productIds);
    if (error) throw error;
    return ((data ?? []) as BalanceRow[]).map((row) => ({
      businessId: row.business_id,
      branchId: row.branch_id,
      productId: row.product_id,
      quantity: row.quantity,
      updatedAt: row.updated_at,
    }));
  }
  async movements(
    businessId: string,
    branchId: string,
    productId: string,
    limit: number,
  ): Promise<StockMovement[]> {
    const { data, error } = await this.client
      .from('stock_movements')
      .select('*')
      .eq('business_id', businessId)
      .eq('branch_id', branchId)
      .eq('product_id', productId)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as MovementRow[]).map((row) => ({
      id: row.id,
      businessId: row.business_id,
      branchId: row.branch_id,
      productId: row.product_id,
      movementType: row.movement_type,
      quantityDelta: row.quantity_delta,
      saleId: row.sale_id,
      saleItemId: row.sale_item_id,
      note: row.note,
      createdBy: row.created_by,
      deviceId: row.device_id,
      occurredAt: row.occurred_at,
      receivedAt: row.received_at,
    }));
  }
  async record(
    change: Parameters<InventoryRepository['record']>[0],
  ): Promise<void> {
    const { error } = await this.client.rpc('record_stock_change', {
      p_id: change.id,
      p_business_id: change.businessId,
      p_branch_id: change.branchId,
      p_product_id: change.productId,
      p_type: change.movementType,
      p_value: change.value,
      p_note: change.note,
    });
    if (error) throw error;
  }
}
