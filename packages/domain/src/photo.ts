import { requireCents } from './product';

export const photoServiceTypes = [
  'print',
  'enlargement',
  'id_photo',
  'editing',
  'restoration',
  'scanning',
  'album',
  'other',
] as const;
export type PhotoServiceType = (typeof photoServiceTypes)[number];
export const photoWorkflowRoutes = ['none', 'lab', 'editing', 'other'] as const;
export type PhotoWorkflowRoute = (typeof photoWorkflowRoutes)[number];
export const photoFileIntakeStatuses = [
  'not_required',
  'not_requested',
  'awaiting_files',
  'receiving',
  'submitted',
] as const;
export type PhotoFileIntakeStatus = (typeof photoFileIntakeStatuses)[number];
export const photoJobFileStatuses = [
  'pending',
  'uploading',
  'uploaded',
  'failed',
  'removed',
] as const;
export type PhotoJobFileStatus = (typeof photoJobFileStatuses)[number];

export const photoJobSourceChannels = [
  'manual',
  'public_web',
  'future_gmail',
] as const;
export type PhotoJobSourceChannel = (typeof photoJobSourceChannels)[number];

export const photoJobStatuses = [
  'received',
  'in_progress',
  'ready',
  'delivered',
  'cancelled',
] as const;
export type PhotoJobStatus = (typeof photoJobStatuses)[number];
export const photoJobPriorities = ['normal', 'urgent'] as const;
export type PhotoJobPriority = (typeof photoJobPriorities)[number];

export interface PhotoService {
  id: string;
  businessId: string;
  code: string | null;
  name: string;
  serviceType: PhotoServiceType;
  widthMm: number | null;
  heightMm: number | null;
  defaultUnitPriceCents: number;
  workflowRoute: PhotoWorkflowRoute;
  requiresCustomerFiles: boolean;
  /** Published on the public price list (/imprimir). */
  isPublic: boolean;
  /** Customer-facing name; the administrative `name` is used when null. */
  publicName: string | null;
  publicDescription: string | null;
  publicSortOrder: number;
  /** Accepts direct self-service orders. Requires a public, lab, file-receiving service. */
  publicOrderEnabled: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PhotoServiceDetails = Pick<
  PhotoService,
  | 'code'
  | 'name'
  | 'serviceType'
  | 'widthMm'
  | 'heightMm'
  | 'defaultUnitPriceCents'
  | 'workflowRoute'
  | 'requiresCustomerFiles'
  | 'isPublic'
  | 'publicName'
  | 'publicDescription'
  | 'publicSortOrder'
  | 'publicOrderEnabled'
>;

export interface PhotoJob {
  id: string;
  businessId: string;
  branchId: string;
  customerId: string;
  status: PhotoJobStatus;
  priority: PhotoJobPriority;
  promisedAt: string | null;
  notes: string | null;
  sourceAppointmentId: string | null;
  sourceEventId: string | null;
  fileIntakeStatus: PhotoFileIntakeStatus;
  driveFolderId: string | null;
  driveEditedFolderId: string | null;
  /** Where the job came from. Set by the server; clients never change it. */
  sourceChannel: PhotoJobSourceChannel;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoJobItem {
  id: string;
  businessId: string;
  photoJobId: string;
  photoServiceId: string | null;
  /** Applied catalog rule, preserved alongside the monetary snapshot. */
  labVariantId?: string | null;
  priceListId?: string | null;
  serviceNameSnapshot: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  notes: string | null;
  widthMm: number | null;
  heightMm: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoJobFile {
  id: string;
  businessId: string;
  photoJobId: string;
  photoJobItemId: string | null;
  driveFileId: string;
  driveFolderId: string;
  originalFilename: string;
  storedFilename: string;
  mimeType: string | null;
  sizeBytes: number;
  copies: number;
  workflowRoute: PhotoWorkflowRoute;
  status: PhotoJobFileStatus;
  uploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const cleanName = (value: string, message: string) => {
  const result = value.trim().replace(/\s+/g, ' ');
  if (!result) throw new Error(message);
  return result;
};
const optionalMillimeters = (value: number | null) => {
  if (value === null) return null;
  if (!Number.isInteger(value) || value <= 0)
    throw new Error('Las dimensiones deben ser milímetros enteros positivos.');
  return value;
};
export function requirePhotoQuantity(value: number) {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error('La cantidad debe ser un entero mayor que cero.');
  return value;
}
export function photoItemTotal(quantity: number, unitPriceCents: number) {
  const total = requirePhotoQuantity(quantity) * requireCents(unitPriceCents);
  if (!Number.isSafeInteger(total))
    throw new Error('El total está fuera de rango.');
  return total;
}
export function photoJobTotal(items: PhotoJobItem[]) {
  const total = items
    .filter((item) => item.isActive)
    .reduce(
      (sum, item) => sum + photoItemTotal(item.quantity, item.unitPriceCents),
      0,
    );
  if (!Number.isSafeInteger(total))
    throw new Error('El total está fuera de rango.');
  return total;
}
export const PUBLIC_NAME_MAX = 80;
export const PUBLIC_DESCRIPTION_MAX = 300;

export function normalizePhotoServiceDetails(value: PhotoServiceDetails) {
  if (!(photoServiceTypes as readonly string[]).includes(value.serviceType))
    throw new Error('Tipo de servicio fotográfico inválido.');
  if (!(photoWorkflowRoutes as readonly string[]).includes(value.workflowRoute))
    throw new Error('Ruta de producción fotográfica inválida.');
  const widthMm = optionalMillimeters(value.widthMm);
  const heightMm = optionalMillimeters(value.heightMm);
  if ((widthMm === null) !== (heightMm === null))
    throw new Error('Completá ambas dimensiones o dejá ambas vacías.');
  const publicName = value.publicName?.trim().replace(/\s+/g, ' ') || null;
  if (publicName && publicName.length > PUBLIC_NAME_MAX)
    throw new Error(
      `El nombre público admite hasta ${PUBLIC_NAME_MAX} caracteres.`,
    );
  const publicDescription = value.publicDescription?.trim() || null;
  if (publicDescription && publicDescription.length > PUBLIC_DESCRIPTION_MAX)
    throw new Error(
      `La descripción pública admite hasta ${PUBLIC_DESCRIPTION_MAX} caracteres.`,
    );
  if (!Number.isInteger(value.publicSortOrder))
    throw new Error('El orden público debe ser un número entero.');
  if (value.publicOrderEnabled) {
    if (!value.isPublic)
      throw new Error(
        'Para recibir pedidos directos el servicio debe ser público.',
      );
    if (value.workflowRoute !== 'lab' || !value.requiresCustomerFiles)
      throw new Error(
        'Los pedidos directos requieren flujo Laboratorio y archivos del cliente.',
      );
  }
  return {
    code: value.code?.trim() || null,
    name: cleanName(value.name, 'El nombre del servicio es obligatorio.'),
    serviceType: value.serviceType,
    widthMm,
    heightMm,
    defaultUnitPriceCents: requireCents(value.defaultUnitPriceCents),
    workflowRoute: value.workflowRoute,
    requiresCustomerFiles: value.requiresCustomerFiles,
    isPublic: value.isPublic,
    publicName,
    publicDescription,
    publicSortOrder: value.publicSortOrder,
    publicOrderEnabled: value.publicOrderEnabled,
  };
}

export function requirePhotoCopies(value: number) {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error('Las copias deben ser un entero mayor que cero.');
  return value;
}

export function photoCopiesMismatch(
  item: Pick<PhotoJobItem, 'quantity'>,
  files: Array<Pick<PhotoJobFile, 'copies' | 'status'>>,
) {
  const copies = files
    .filter((file) => file.status === 'uploaded')
    .reduce((sum, file) => sum + requirePhotoCopies(file.copies), 0);
  return {
    copies,
    expected: item.quantity,
    mismatch: copies !== item.quantity,
  };
}

export function sanitizeDriveName(value: string) {
  const cleaned = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // eslint-disable-next-line no-control-regex -- Drive names must reject ASCII controls.
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');
  return (cleaned || 'Sin nombre').slice(0, 120);
}
/** The name a customer sees on the public price list. */
export const photoServicePublicName = (
  service: Pick<PhotoService, 'name' | 'publicName'>,
) => service.publicName?.trim() || service.name;

/**
 * Public tracking states. A customer sees four steps; the internal state machine keeps
 * its own names. `cancelled` is shown as such so a cancelled order never looks pending.
 */
export const publicOrderStatusLabels: Record<PhotoJobStatus, string> = {
  received: 'Pedido recibido',
  in_progress: 'En preparación',
  ready: 'Listo para retirar',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};
export function publicOrderStatusLabel(status: string) {
  return (
    (publicOrderStatusLabels as Record<string, string>)[status] ??
    'Pedido recibido'
  );
}

export function isPhotoServiceSelectable(
  service: Pick<PhotoService, 'isActive'>,
) {
  return service.isActive;
}
export function normalizePhotoJobDetails(
  value: Pick<
    PhotoJob,
    | 'customerId'
    | 'status'
    | 'priority'
    | 'promisedAt'
    | 'notes'
    | 'sourceAppointmentId'
    | 'sourceEventId'
  >,
) {
  const customerId = cleanName(value.customerId, 'El cliente es obligatorio.');
  if (!(photoJobStatuses as readonly string[]).includes(value.status))
    throw new Error('Estado de trabajo fotográfico inválido.');
  if (!(photoJobPriorities as readonly string[]).includes(value.priority))
    throw new Error('Prioridad inválida.');
  if (value.promisedAt && Number.isNaN(Date.parse(value.promisedAt)))
    throw new Error('Fecha prometida inválida.');
  return {
    customerId,
    status: value.status,
    priority: value.priority,
    promisedAt: value.promisedAt,
    notes: value.notes?.trim() || null,
    sourceAppointmentId: value.sourceAppointmentId?.trim() || null,
    sourceEventId: value.sourceEventId?.trim() || null,
  };
}
export function normalizePhotoJobItemDetails(
  value: Pick<
    PhotoJobItem,
    | 'photoServiceId'
    | 'serviceNameSnapshot'
    | 'quantity'
    | 'unitPriceCents'
    | 'notes'
    | 'widthMm'
    | 'heightMm'
    | 'isActive'
  > &
    Pick<PhotoJobItem, 'labVariantId' | 'priceListId'>,
) {
  const widthMm = optionalMillimeters(value.widthMm);
  const heightMm = optionalMillimeters(value.heightMm);
  if ((widthMm === null) !== (heightMm === null))
    throw new Error('Completá ambas dimensiones o dejá ambas vacías.');
  const quantity = requirePhotoQuantity(value.quantity);
  const unitPriceCents = requireCents(value.unitPriceCents);
  return {
    photoServiceId: value.photoServiceId?.trim() || null,
    labVariantId: value.labVariantId?.trim() || null,
    priceListId: value.priceListId?.trim() || null,
    serviceNameSnapshot: cleanName(
      value.serviceNameSnapshot,
      'El concepto es obligatorio.',
    ),
    quantity,
    unitPriceCents,
    totalCents: photoItemTotal(quantity, unitPriceCents),
    notes: value.notes?.trim() || null,
    widthMm,
    heightMm,
    isActive: value.isActive,
  };
}
export function isPhotoJobOverdue(
  job: Pick<PhotoJob, 'promisedAt' | 'status'>,
  now = new Date(),
) {
  return Boolean(
    job.promisedAt &&
    !['delivered', 'cancelled'].includes(job.status) &&
    Date.parse(job.promisedAt) < now.getTime(),
  );
}
export function comparePhotoProductionQueue(
  a: PhotoJob,
  b: PhotoJob,
  now = new Date(),
) {
  if (a.priority !== b.priority) return a.priority === 'urgent' ? -1 : 1;
  const overdue =
    Number(isPhotoJobOverdue(b, now)) - Number(isPhotoJobOverdue(a, now));
  if (overdue) return overdue;
  if (a.promisedAt !== b.promisedAt) {
    if (!a.promisedAt) return 1;
    if (!b.promisedAt) return -1;
    return a.promisedAt.localeCompare(b.promisedAt);
  }
  return a.createdAt.localeCompare(b.createdAt);
}
