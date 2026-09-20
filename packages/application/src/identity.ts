import type { Branch, Business, Device } from '@centrocolor/domain';

export interface BusinessRepository {
  findById(id: string): Promise<Business | null>;
}

export interface BranchRepository {
  findById(id: string): Promise<Branch | null>;
}

export interface DeviceRepository {
  findById(id: string): Promise<Device | null>;
}

export interface AppContext {
  businessId: string;
  branchId: string;
  deviceId: string;
  installationId: string;
}

export async function resolveAppContext(
  ids: { businessId: string; branchId: string; deviceId: string },
  repositories: {
    businesses: BusinessRepository;
    branches: BranchRepository;
    devices: DeviceRepository;
  },
): Promise<AppContext> {
  const [business, branch, device] = await Promise.all([
    repositories.businesses.findById(ids.businessId),
    repositories.branches.findById(ids.branchId),
    repositories.devices.findById(ids.deviceId),
  ]);
  if (!business || !branch || !device)
    throw new Error('Identity context is incomplete');
  if (
    business.id !== ids.businessId ||
    branch.id !== ids.branchId ||
    device.id !== ids.deviceId ||
    branch.businessId !== business.id ||
    device.businessId !== business.id ||
    device.branchId !== branch.id
  ) {
    throw new Error('Identity context contains mismatched relationships');
  }
  return {
    businessId: business.id,
    branchId: branch.id,
    deviceId: device.id,
    installationId: device.installationId,
  };
}
