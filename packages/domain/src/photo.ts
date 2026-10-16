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
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

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
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoJobItem {
  id: string;
  businessId: string;
  photoJobId: string;
  photoServiceId: string | null;
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
export function normalizePhotoServiceDetails(
  value: Pick<
    PhotoService,
    | 'code'
    | 'name'
    | 'serviceType'
    | 'widthMm'
    | 'heightMm'
    | 'defaultUnitPriceCents'
  >,
) {
  if (!(photoServiceTypes as readonly string[]).includes(value.serviceType))
    throw new Error('Tipo de servicio fotográfico inválido.');
  const widthMm = optionalMillimeters(value.widthMm);
  const heightMm = optionalMillimeters(value.heightMm);
  if ((widthMm === null) !== (heightMm === null))
    throw new Error('Completá ambas dimensiones o dejá ambas vacías.');
  return {
    code: value.code?.trim() || null,
    name: cleanName(value.name, 'El nombre del servicio es obligatorio.'),
    serviceType: value.serviceType,
    widthMm,
    heightMm,
    defaultUnitPriceCents: requireCents(value.defaultUnitPriceCents),
  };
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
  >,
) {
  const widthMm = optionalMillimeters(value.widthMm);
  const heightMm = optionalMillimeters(value.heightMm);
  if ((widthMm === null) !== (heightMm === null))
    throw new Error('Completá ambas dimensiones o dejá ambas vacías.');
  const quantity = requirePhotoQuantity(value.quantity);
  const unitPriceCents = requireCents(value.unitPriceCents);
  return {
    photoServiceId: value.photoServiceId?.trim() || null,
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
