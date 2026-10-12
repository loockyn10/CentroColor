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
export { requireStockQuantity } from './inventory';
export type {
  InventoryBalance,
  StockMovement,
  StockMovementType,
} from './inventory';
export {
  appointmentStatuses,
  normalizeAppointmentDetails,
  normalizeAppointmentTypeDetails,
  overlapsAppointment,
  parseAppointmentStatus,
  withAppointmentDuration,
} from './appointment';
export type {
  Appointment,
  AppointmentDetails,
  AppointmentStatus,
  AppointmentType,
  AppointmentTypeDetails,
} from './appointment';
export {
  eventStatuses,
  eventStatusBlocksResources,
  eventTotals,
  normalizeEventDetails,
  normalizeEventServiceItemDetails,
  normalizeEventTypeDetails,
  normalizeResourceDetails,
  normalizeResourceReservationDetails,
  parseEventStatus,
  reservationsOverlap,
} from './event';
export {
  frameMaterialTypes,
  framePricingUnits,
  frameQuoteStatuses,
  frameJobStatuses,
  frameMeasurementModes,
  centimetersToMillimeters,
  mouldingLengthMm,
  materialAreaMm2,
  applyWaste,
  markupPrice,
  calculateFrameQuote,
  normalizeMouldingDetails,
  normalizeMaterialDetails,
} from './framing';
export type {
  FrameMoulding,
  FrameMaterial,
  FrameMaterialType,
  FramePricingUnit,
  FramingSettings,
  FrameQuote,
  FrameQuoteItem,
  FrameQuoteItemType,
  FrameQuoteStatus,
  FrameJob,
  FrameJobStatus,
  FrameMeasurementMode,
  FrameCalculation,
  FrameCalculationMaterial,
} from './framing';
export type {
  Event,
  EventDetails,
  EventServiceItem,
  EventServiceItemDetails,
  EventStatus,
  EventType,
  EventTypeDetails,
  Resource,
  ResourceDetails,
  ResourceReservation,
  ResourceReservationDetails,
} from './event';
