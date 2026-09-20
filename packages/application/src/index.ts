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
