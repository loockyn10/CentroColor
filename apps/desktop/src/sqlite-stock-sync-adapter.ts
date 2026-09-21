import Database from '@tauri-apps/plugin-sql';
import type { StockCursor, StockSyncLocalPort } from '@centrocolor/application';
import type { StockMovement } from '@centrocolor/domain';

const database = () => Database.load('sqlite:centrocolor.db');
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
  received_at: string | null;
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

export class SQLiteStockSyncAdapter implements StockSyncLocalPort {
  async pending(businessId: string, limit: number): Promise<StockMovement[]> {
    const db = await database();
    const rows = await db.select<Row[]>(
      `SELECT m.* FROM stock_sync_outbox o
      JOIN stock_movements m ON m.id=o.movement_id AND m.business_id=o.business_id
      WHERE o.business_id=? ORDER BY o.created_at,o.movement_id LIMIT ?`,
      [businessId, limit],
    );
    return rows.map(decode);
  }
  async acknowledge(
    movement: StockMovement,
    cloud: StockMovement,
  ): Promise<void> {
    const db = await database();
    await db.execute(
      'UPDATE stock_movements SET received_at=? WHERE id=? AND business_id=?',
      [cloud.receivedAt, movement.id, movement.businessId],
    );
    await db.execute(
      'DELETE FROM stock_sync_outbox WHERE movement_id=? AND business_id=?',
      [movement.id, movement.businessId],
    );
  }
  async fail(movement: StockMovement, message: string): Promise<void> {
    const db = await database();
    await db.execute(
      'UPDATE stock_sync_outbox SET attempts=attempts+1,last_error=? WHERE movement_id=? AND business_id=?',
      [message.slice(0, 500), movement.id, movement.businessId],
    );
  }
  async cursor(businessId: string): Promise<StockCursor | null> {
    const db = await database();
    const rows = await db.select<
      { received_at: string; movement_id: string }[]
    >(
      'SELECT received_at,movement_id FROM stock_sync_cursor WHERE business_id=?',
      [businessId],
    );
    return rows[0]
      ? { receivedAt: rows[0].received_at, id: rows[0].movement_id }
      : null;
  }
  async applyRemote(movement: StockMovement): Promise<void> {
    const db = await database();
    await db.execute(
      `INSERT OR IGNORE INTO stock_movements
      (id,business_id,branch_id,product_id,movement_type,quantity_delta,sale_id,sale_item_id,
       note,created_by,device_id,occurred_at,received_at,sync_origin)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'remote')`,
      [
        movement.id,
        movement.businessId,
        movement.branchId,
        movement.productId,
        movement.movementType,
        movement.quantityDelta,
        movement.saleId,
        movement.saleItemId,
        movement.note,
        movement.createdBy,
        movement.deviceId,
        movement.occurredAt,
        movement.receivedAt,
      ],
    );
    const rows = await db.select<Row[]>(
      'SELECT * FROM stock_movements WHERE id=? AND business_id=?',
      [movement.id, movement.businessId],
    );
    const local = rows[0] && decode(rows[0]);
    if (
      !local ||
      local.branchId !== movement.branchId ||
      local.productId !== movement.productId ||
      local.movementType !== movement.movementType ||
      local.quantityDelta !== movement.quantityDelta ||
      local.saleItemId !== movement.saleItemId ||
      local.createdBy !== movement.createdBy
    )
      throw new Error('El UUID de movimiento local tiene otros datos.');
    if (!local.receivedAt)
      await db.execute(
        'UPDATE stock_movements SET received_at=? WHERE id=? AND business_id=?',
        [movement.receivedAt, movement.id, movement.businessId],
      );
  }
  async advanceCursor(businessId: string, cursor: StockCursor): Promise<void> {
    const db = await database();
    await db.execute(
      `INSERT INTO stock_sync_cursor(business_id,received_at,movement_id) VALUES(?,?,?)
      ON CONFLICT(business_id) DO UPDATE SET received_at=excluded.received_at,movement_id=excluded.movement_id`,
      [businessId, cursor.receivedAt, cursor.id],
    );
  }
  async summary(
    businessId: string,
  ): Promise<{ pending: number; lastError: string | null }> {
    const db = await database();
    const rows = await db.select<{ pending: number }[]>(
      'SELECT count(*) AS pending FROM stock_sync_outbox WHERE business_id=?',
      [businessId],
    );
    const errors = await db.select<{ last_error: string | null }[]>(
      'SELECT last_error FROM stock_sync_outbox WHERE business_id=? AND last_error IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      [businessId],
    );
    return {
      pending: rows[0]?.pending ?? 0,
      lastError: errors[0]?.last_error ?? null,
    };
  }
}
