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
