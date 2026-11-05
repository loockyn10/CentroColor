import { describe, expect, it } from 'vitest';
import {
  addDaysKey,
  addMonthsKey,
  buildMonthGrid,
  clampKey,
  dateForKey,
  formatDateKey,
  formatDateTimeKey,
  isDisabledKey,
  joinDateTime,
  parseDateKey,
  splitDateTime,
  stepTimePart,
  weekdayIndex,
} from './date-utils';

describe('fechas del selector', () => {
  it('valida y formatea', () => {
    expect(parseDateKey('2026-02-30')).toBeNull();
    expect(parseDateKey('2026-11-05')).toEqual({
      year: 2026,
      month: 11,
      day: 5,
    });
    expect(formatDateKey('2026-11-05')).toBe('05/11/2026');
    expect(formatDateKey('')).toBe('');
  });
  it('suma días y meses con desborde', () => {
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonthsKey('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsKey('2026-01-15', -1)).toBe('2025-12-15');
  });
  it('la semana arranca en lunes', () => {
    expect(weekdayIndex('2026-11-02')).toBe(0); // lunes
    expect(weekdayIndex('2026-11-08')).toBe(6); // domingo
    const grid = buildMonthGrid(2026, 11);
    expect(grid).toHaveLength(42);
    expect(grid[0]!.key).toBe('2026-10-26');
    expect(grid.find((c) => c.key === '2026-11-01')!.inMonth).toBe(true);
    expect(grid[0]!.inMonth).toBe(false);
  });
  it('respeta mínimo y máximo', () => {
    expect(isDisabledKey('2026-11-01', '2026-11-05', undefined)).toBe(true);
    expect(isDisabledKey('2026-11-10', '2026-11-05', '2026-11-09')).toBe(true);
    expect(clampKey('2026-12-01', undefined, '2026-11-30')).toBe('2026-11-30');
  });
  it('fecha y hora conservan el formato del input nativo', () => {
    expect(splitDateTime('2026-11-05T14:30')).toEqual({
      date: '2026-11-05',
      time: { hour: 14, minute: 30 },
    });
    expect(joinDateTime('2026-11-05', { hour: 9, minute: 5 })).toBe(
      '2026-11-05T09:05',
    );
    expect(joinDateTime('', { hour: 9, minute: 5 })).toBe('');
    expect(formatDateTimeKey('2026-11-05T14:30')).toBe('05/11/2026 14:30');
    expect(stepTimePart(23, 1, 24)).toBe(0);
    expect(stepTimePart(0, -5, 60)).toBe(55);
  });
});

describe('teclado del calendario', () => {
  it('flechas, RePág/AvPág, Inicio y Fin', () => {
    const day = '2026-11-05'; // jueves
    expect(dateForKey(day, 'ArrowRight')).toBe('2026-11-06');
    expect(dateForKey(day, 'ArrowLeft')).toBe('2026-11-04');
    expect(dateForKey(day, 'ArrowDown')).toBe('2026-11-12');
    expect(dateForKey(day, 'ArrowUp')).toBe('2026-10-29');
    expect(dateForKey(day, 'PageDown')).toBe('2026-12-05');
    expect(dateForKey(day, 'PageUp', true)).toBe('2025-11-05');
    expect(dateForKey(day, 'Home')).toBe('2026-11-02');
    expect(dateForKey(day, 'End')).toBe('2026-11-08');
    expect(dateForKey(day, 'Enter')).toBeNull();
  });
});
