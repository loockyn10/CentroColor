export interface Business {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  businessId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const deviceTypes = ['desktop', 'web', 'mobile'] as const;
export type DeviceType = (typeof deviceTypes)[number];

export interface Device {
  id: string;
  businessId: string;
  branchId: string;
  name: string;
  deviceType: DeviceType;
  installationId: string;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function parseDeviceType(value: string): DeviceType {
  if (deviceTypes.some((type) => type === value)) return value as DeviceType;
  throw new Error(`Unsupported device type: ${value}`);
}
