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
export {
  changeAppointmentStatus,
  createAppointment,
  createAppointmentType,
  updateAppointment,
  updateAppointmentType,
} from './appointment';
export type {
  AppointmentListQuery,
  AppointmentRepository,
  AppointmentSummary,
} from './appointment';
export { syncAppointments } from './appointment-sync';
export type {
  AppointmentSyncCloudPort,
  AppointmentSyncCursor,
  AppointmentSyncEntity,
  AppointmentSyncLocalPort,
  AppointmentSyncType,
  PendingAppointmentChange,
} from './appointment-sync';
export {
  changeEventStatus,
  createEvent,
  createEventServiceItem,
  createEventType,
  createResource,
  createResourceReservation,
  updateEvent,
  updateEventType,
  updateResource,
} from './event';
export type {
  EventBundle,
  EventListQuery,
  EventRepository,
  EventSummary,
  ResourceReservationQuery,
  ResourceReservationSummary,
} from './event';
export { syncEventEntities } from './event-sync';
export type {
  EventPushResult,
  EventSyncCloudPort,
  EventSyncCursor,
  EventSyncEntity,
  EventSyncLocalPort,
  EventSyncType,
  PendingEventChange,
} from './event-sync';
export { createMoulding, createMaterial, newQuote } from './framing';
export type { FramingRepository } from './framing';
export { syncFramingEntities } from './framing-sync';
export type {
  FramingSyncCloudPort,
  FramingSyncEntity,
  FramingSyncLocalPort,
  FramingSyncType,
  PendingFramingChange,
  FramingCursor,
} from './framing-sync';
export {
  createPhotoService,
  buildPhotoJob,
  sortPhotoProductionQueue,
} from './photo';
export type {
  PhotoRepository,
  PhotoJobSummary,
  PhotoJobBundle,
  PhotoJobListQuery,
  PhotoFileIntakeAdminRepository,
  GoogleDriveIntegrationView,
  UploadLinkView,
} from './photo';
export { syncPhotoEntities } from './photo-sync';
export { syncPhotoFiles } from './photo-file-sync';
export type {
  PhotoFileCursor,
  PhotoFileSyncLocalPort,
  PhotoFileSyncCloudPort,
} from './photo-file-sync';
export type {
  PhotoSyncType,
  PhotoSyncEntity,
  PhotoSyncCursor,
  PendingPhotoChange,
  PhotoSyncLocalPort,
  PhotoSyncCloudPort,
} from './photo-sync';
export { postWorkPayment, voidWorkPayment } from './payment';
export type { WorkPaymentRepository } from './payment';
export { syncWorkPayments } from './payment-sync';
export type {
  WorkPaymentCursor,
  PendingWorkPayment,
  WorkPaymentSyncLocalPort,
  WorkPaymentSyncCloudPort,
} from './payment-sync';
