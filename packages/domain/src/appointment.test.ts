import { describe, expect, it } from 'vitest';
import {
  normalizeAppointmentDetails,
  normalizeAppointmentTypeDetails,
  overlapsAppointment,
  withAppointmentDuration,
  type Appointment,
} from './appointment';

const appointment: Appointment = {
  id: 'a',
  businessId: 'business',
  branchId: 'branch',
  customerId: 'customer',
  appointmentTypeId: null,
  title: 'Foto carnet',
  startsAt: '2026-10-11T13:00:00.000Z',
  endsAt: '2026-10-11T13:15:00.000Z',
  status: 'scheduled',
  notes: null,
  createdBy: 'user',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('appointments', () => {
  it('requires a type name and a positive duration', () => {
    expect(() =>
      normalizeAppointmentTypeDetails({
        name: ' ',
        defaultDurationMinutes: 15,
      }),
    ).toThrow(/nombre/i);
    expect(() =>
      normalizeAppointmentTypeDetails({
        name: 'Foto',
        defaultDurationMinutes: 0,
      }),
    ).toThrow(/duración/i);
  });

  it('requires the end after the start', () => {
    expect(() =>
      normalizeAppointmentDetails({
        customerId: 'customer',
        appointmentTypeId: null,
        title: 'Turno',
        startsAt: appointment.startsAt,
        endsAt: appointment.startsAt,
        notes: null,
      }),
    ).toThrow(/posterior/i);
  });

  it('calculates the automatic duration using instants', () => {
    expect(withAppointmentDuration(appointment.startsAt, 15)).toBe(
      appointment.endsAt,
    );
  });

  it('detects scheduled overlap but ignores cancelled appointments', () => {
    const candidate = {
      id: 'b',
      branchId: 'branch',
      startsAt: '2026-10-11T13:10:00.000Z',
      endsAt: '2026-10-11T13:30:00.000Z',
    };
    expect(overlapsAppointment(candidate, appointment)).toBe(true);
    expect(
      overlapsAppointment(candidate, { ...appointment, status: 'cancelled' }),
    ).toBe(false);
    expect(
      overlapsAppointment(candidate, { ...appointment, branchId: 'other' }),
    ).toBe(false);
  });
});
