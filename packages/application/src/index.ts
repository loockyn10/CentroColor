/** Port implemented by a platform adapter; contains no database-specific API. */
export interface StorageHealthPort {
  check(): Promise<'ready' | 'unavailable'>;
}

export async function getStorageHealth(
  port: StorageHealthPort,
): Promise<'ready' | 'unavailable'> {
  return port.check();
}

export { resolveAppContext } from './identity';
export type {
  AppContext,
  BusinessRepository,
  BranchRepository,
  DeviceRepository,
} from './identity';
export { resolveBusinessContext } from './auth';
export type { AuthorizedIdentity, BusinessContext } from './auth';
export {
  customerListLimit,
  listCustomers,
  searchCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deactivateCustomer,
  reactivateCustomer,
} from './customer';
export type { CustomerRepository } from './customer';
export { syncCustomers } from './customer-sync';
export type {
  CustomerCursor,
  PendingCustomerChange,
  CustomerSyncLocalPort,
  CustomerSyncCloudPort,
  CustomerSyncResult,
  CustomerPushResult,
} from './customer-sync';
export {
  createProduct,
  updateProduct,
  createCategory,
  addToCart,
  setCartQuantity,
  removeFromCart,
  scanBarcode,
  completeSale,
} from './pos';
export type { ProductRepository, SaleRepository, ScanResult } from './pos';
export { recordStockChange, stockWarnings } from './inventory';
export type { InventoryRepository } from './inventory';
export { syncStockMovements } from './stock-sync';
export type {
  StockCursor,
  StockSyncLocalPort,
  StockSyncCloudPort,
} from './stock-sync';
export { syncPosMutable, syncPosSales } from './pos-sync';
export type {
  PosMutableType,
  PosEntityType,
  PosMutable,
  PosCursor,
  PendingPosChange,
  SaleBundle,
  PendingSale,
  PosSyncLocalPort,
  PosSyncCloudPort,
  PosSyncResult,
} from './pos-sync';
