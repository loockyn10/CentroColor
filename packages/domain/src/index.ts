/** Stable identifier guard for future domain entities. */
export function requireId(value: string): string {
  const id = value.trim();
  if (id.length === 0) throw new Error('An identifier is required');
  return id;
}

export { deviceTypes, parseDeviceType } from './identity';
export type { Business, Branch, Device, DeviceType } from './identity';
export { businessRoles, parseBusinessRole } from './auth';
export type { BusinessRole, Profile, BusinessMembership } from './auth';
