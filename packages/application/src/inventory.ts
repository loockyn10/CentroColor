import type {
  InventoryBalance,
  StockMovement,
  StockMovementType,
} from '@centrocolor/domain';
import { requireStockQuantity } from '@centrocolor/domain';
import type { CartLine } from '@centrocolor/domain';

export interface InventoryRepository {
  balances(
    businessId: string,
    branchId: string,
    productIds: string[],
  ): Promise<InventoryBalance[]>;
  movements(
    businessId: string,
    branchId: string,
    productId: string,
    limit: number,
  ): Promise<StockMovement[]>;
  record(change: {
    id: string;
    businessId: string;
    branchId: string;
    productId: string;
    movementType: Exclude<StockMovementType, 'sale'>;
    value: number;
    note: string | null;
    occurredAt: string;
  }): Promise<void>;
}

export function stockWarnings(
  lines: CartLine[],
  balances: Record<string, number>,
) {
  return lines
    .filter(
      (line) =>
        line.tracksInventory && line.quantity > (balances[line.productId] ?? 0),
    )
    .map((line) => ({
      productId: line.productId,
      productName: line.productName,
      requested: line.quantity,
      available: balances[line.productId] ?? 0,
    }));
}

export function recordStockChange(
  repository: InventoryRepository,
  context: {
    businessId: string;
    branchId: string;
    role: 'owner' | 'admin' | 'staff';
  },
  productId: string,
  movementType: 'initial' | 'entry' | 'adjustment',
  value: number,
  note: string | null,
) {
  if (context.role === 'staff')
    throw new Error('Solo owner/admin puede modificar stock.');
  requireStockQuantity(value);
  if (movementType === 'entry' && value === 0)
    throw new Error('La entrada debe ser positiva.');
  return repository.record({
    id: crypto.randomUUID(),
    businessId: context.businessId,
    branchId: context.branchId,
    productId,
    movementType,
    value,
    note: note?.trim() || null,
    occurredAt: new Date().toISOString(),
  });
}
