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
export { normalizeCustomerDetails } from './customer';
export type { Customer, CustomerDetails } from './customer';
export {
  normalizeBarcode,
  normalizeProductDetails,
  normalizeCategoryName,
  requireCents,
} from './product';
export type { Product, ProductCategory, ProductDetails } from './product';
export {
  paymentMethods,
  parsePaymentMethod,
  lineTotal,
  cartTotal,
} from './sale';
export type { CartLine, Sale, SaleItem, PaymentMethod } from './sale';
