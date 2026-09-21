export type StockMovementType = 'initial' | 'entry' | 'adjustment' | 'sale';

export interface InventoryBalance {
  businessId: string;
  branchId: string;
  productId: string;
  quantity: number;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  businessId: string;
  branchId: string;
  productId: string;
  movementType: StockMovementType;
  quantityDelta: number;
  saleId: string | null;
  saleItemId: string | null;
  note: string | null;
  createdBy: string;
  deviceId: string | null;
  occurredAt: string;
  receivedAt: string | null;
}

export function requireStockQuantity(
  value: number,
  allowNegative = false,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value > 2147483647 ||
    value < -2147483648 ||
    (!allowNegative && value < 0)
  )
    throw new Error('La cantidad debe ser un entero válido.');
  return value;
}
