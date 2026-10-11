export const appointmentStatuses = [
  'scheduled',
  'completed',
  'cancelled',
  'no_show',
] as const;

export type AppointmentStatus = (typeof appointmentStatuses)[number];

export interface AppointmentType {
  id: string;
  businessId: string;
  name: string;
  defaultDurationMinutes: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Appointment {
  id: string;
  businessId: string;
  branchId: string;
  customerId: string;
  appointmentTypeId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type AppointmentTypeDetails = Pick<
  AppointmentType,
  'name' | 'defaultDurationMinutes'
>;

export type AppointmentDetails = Pick<
  Appointment,
  'customerId' | 'appointmentTypeId' | 'title' | 'startsAt' | 'endsAt' | 'notes'
>;

export function normalizeAppointmentTypeDetails(
  details: AppointmentTypeDetails,
): AppointmentTypeDetails {
  const name = details.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('El nombre del tipo de turno es obligatorio.');
  if (
    !Number.isInteger(details.defaultDurationMinutes) ||
    details.defaultDurationMinutes <= 0 ||
    details.defaultDurationMinutes > 24 * 60
  )
    throw new Error('La duración debe ser un número de minutos mayor a cero.');
  return { name, defaultDurationMinutes: details.defaultDurationMinutes };
}

export function normalizeAppointmentDetails(
  details: AppointmentDetails,
): AppointmentDetails {
  const title = details.title.trim().replace(/\s+/g, ' ');
  if (!details.customerId.trim()) throw new Error('Seleccioná un cliente.');
  if (!title) throw new Error('El título del turno es obligatorio.');
  const start = Date.parse(details.startsAt);
  const end = Date.parse(details.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end))
    throw new Error('Ingresá una fecha y horario válidos.');
  if (end <= start)
    throw new Error('La hora de fin debe ser posterior al inicio.');
  return {
    customerId: details.customerId.trim(),
    appointmentTypeId: details.appointmentTypeId?.trim() || null,
    title,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    notes: details.notes?.trim() || null,
  };
}

export function parseAppointmentStatus(value: string): AppointmentStatus {
  if ((appointmentStatuses as readonly string[]).includes(value))
    return value as AppointmentStatus;
  throw new Error('Estado de turno inválido.');
}

export function withAppointmentDuration(
  startsAt: string,
  durationMinutes: number,
): string {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0)
    throw new Error('La duración debe ser mayor a cero.');
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) throw new Error('El inicio no es válido.');
  return new Date(start + durationMinutes * 60_000).toISOString();
}

export function overlapsAppointment(
  candidate: Pick<Appointment, 'id' | 'branchId' | 'startsAt' | 'endsAt'>,
  existing: Appointment,
): boolean {
  if (
    existing.id === candidate.id ||
    existing.branchId !== candidate.branchId ||
    existing.status !== 'scheduled'
  )
    return false;
  return (
    Date.parse(candidate.startsAt) < Date.parse(existing.endsAt) &&
    Date.parse(candidate.endsAt) > Date.parse(existing.startsAt)
  );
}
