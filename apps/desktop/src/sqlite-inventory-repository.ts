import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import type { InventoryRepository } from '@centrocolor/application';
import type {
  InventoryBalance,
  StockMovement,
  StockMovementType,
} from '@centrocolor/domain';

const database = () => Database.load('sqlite:centrocolor.db');
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
  received_at: string | null;
};

export class SQLiteInventoryRepository implements InventoryRepository {
  async balances(
    businessId: string,
    branchId: string,
    productIds: string[],
  ): Promise<InventoryBalance[]> {
    if (!productIds.length) return [];
    const db = await database();
    const rows = await db.select<BalanceRow[]>(
      `SELECT business_id,branch_id,product_id,quantity,updated_at FROM inventory_balances
       WHERE business_id=? AND branch_id=? AND product_id IN (${productIds.map(() => '?').join(',')})`,
      [businessId, branchId, ...productIds],
    );
    return rows.map((row) => ({
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
    const db = await database();
    const rows = await db.select<MovementRow[]>(
      `SELECT * FROM stock_movements WHERE business_id=? AND branch_id=? AND product_id=?
       ORDER BY occurred_at DESC,id DESC LIMIT ?`,
      [businessId, branchId, productId, limit],
    );
    return rows.map((row) => ({
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
    await invoke('record_local_stock', { change });
  }
}
