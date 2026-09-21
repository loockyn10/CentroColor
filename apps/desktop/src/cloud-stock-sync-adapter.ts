import type { SupabaseClient } from '@supabase/supabase-js';
import type { StockCursor, StockSyncCloudPort } from '@centrocolor/application';
import type { StockMovement } from '@centrocolor/domain';

type Row = {
  id: string;
  business_id: string;
  branch_id: string;
  product_id: string;
  movement_type: StockMovement['movementType'];
  quantity_delta: number;
  sale_id: string | null;
  sale_item_id: string | null;
  note: string | null;
  created_by: string;
  device_id: string | null;
  occurred_at: string;
  received_at: string;
};
const decode = (row: Row): StockMovement => ({
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
});

export class CloudStockSyncAdapter implements StockSyncCloudPort {
  constructor(private readonly client: SupabaseClient) {}
  async push(movement: StockMovement): Promise<StockMovement> {
    const { data, error } = await this.client.rpc('apply_stock_movement', {
      p_movement: {
        id: movement.id,
        business_id: movement.businessId,
        branch_id: movement.branchId,
        product_id: movement.productId,
        movement_type: movement.movementType,
        quantity_delta: movement.quantityDelta,
        sale_id: movement.saleId,
        sale_item_id: movement.saleItemId,
        note: movement.note,
        created_by: movement.createdBy,
        device_id: movement.deviceId,
        occurred_at: movement.occurredAt,
      },
    });
    if (error) throw error;
    return decode(data as Row);
  }
  async pull(
    businessId: string,
    after: StockCursor | null,
    limit: number,
  ): Promise<StockMovement[]> {
    let query = this.client
      .from('stock_movements')
      .select('*')
      .eq('business_id', businessId);
    if (after)
      query = query.or(
        `received_at.gt.${after.receivedAt},and(received_at.eq.${after.receivedAt},id.gt.${after.id})`,
      );
    const { data, error } = await query
      .order('received_at')
      .order('id')
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(decode);
  }
}
