import {
  normalizeAppointmentDetails,
  normalizeAppointmentTypeDetails,
  parseAppointmentStatus,
  type Appointment,
  type AppointmentDetails,
  type AppointmentStatus,
  type AppointmentType,
  type AppointmentTypeDetails,
} from '@centrocolor/domain';

export interface AppointmentSummary extends Appointment {
  customerName: string;
  appointmentTypeName: string | null;
}

export interface AppointmentListQuery {
  businessId: string;
  branchId: string;
  from: string;
  to: string;
  status?: AppointmentStatus | null;
  query?: string;
  limit: number;
}

export interface AppointmentRepository {
  listTypes(
    businessId: string,
    includeInactive?: boolean,
  ): Promise<AppointmentType[]>;
  getType(businessId: string, id: string): Promise<AppointmentType | null>;
  createType(type: AppointmentType): Promise<AppointmentType>;
  updateType(
    businessId: string,
    id: string,
    details: AppointmentTypeDetails,
  ): Promise<AppointmentType>;
  setTypeActive(
    businessId: string,
    id: string,
    active: boolean,
  ): Promise<AppointmentType>;
  list(query: AppointmentListQuery): Promise<AppointmentSummary[]>;
  get(businessId: string, id: string): Promise<Appointment | null>;
  create(appointment: Appointment): Promise<Appointment>;
  update(
    businessId: string,
    id: string,
    details: AppointmentDetails,
  ): Promise<Appointment>;
  setStatus(
    businessId: string,
    id: string,
    status: AppointmentStatus,
  ): Promise<Appointment>;
  overlaps(
    businessId: string,
    branchId: string,
    startsAt: string,
    endsAt: string,
    excludeId?: string,
  ): Promise<AppointmentSummary[]>;
}

export function createAppointmentType(
  repository: AppointmentRepository,
  businessId: string,
  details: AppointmentTypeDetails,
  options: { id?: string; now?: string } = {},
) {
  const now = options.now ?? new Date().toISOString();
  return repository.createType({
    id: options.id ?? crypto.randomUUID(),
    businessId,
    ...normalizeAppointmentTypeDetails(details),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

export function updateAppointmentType(
  repository: AppointmentRepository,
  businessId: string,
  id: string,
  details: AppointmentTypeDetails,
) {
  return repository.updateType(
    businessId,
    id,
    normalizeAppointmentTypeDetails(details),
  );
}

export function createAppointment(
  repository: AppointmentRepository,
  context: { businessId: string; branchId: string; userId: string },
  details: AppointmentDetails,
  options: { id?: string; now?: string } = {},
) {
  const now = options.now ?? new Date().toISOString();
  return repository.create({
    id: options.id ?? crypto.randomUUID(),
    businessId: context.businessId,
    branchId: context.branchId,
    ...normalizeAppointmentDetails(details),
    status: 'scheduled',
    createdBy: context.userId,
    createdAt: now,
    updatedAt: now,
  });
}

export function updateAppointment(
  repository: AppointmentRepository,
  businessId: string,
  id: string,
  details: AppointmentDetails,
) {
  return repository.update(
    businessId,
    id,
    normalizeAppointmentDetails(details),
  );
}

export function changeAppointmentStatus(
  repository: AppointmentRepository,
  businessId: string,
  id: string,
  status: string,
) {
  return repository.setStatus(businessId, id, parseAppointmentStatus(status));
}
