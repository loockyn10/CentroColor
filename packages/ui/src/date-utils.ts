/**
 * Utilidades de fecha del selector propio. Trabajan con las mismas cadenas que los inputs nativos
 * (`YYYY-MM-DD` y `YYYY-MM-DDTHH:mm`), de modo que reemplazar un `<input type="date">` por
 * `DatePicker` no cambia el formato de los datos. Sin zonas horarias: todo es fecha de calendario.
 */

export interface DateParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseDateKey(
  value: string | null | undefined,
): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month))
    return null;
  return { year, month, day };
}

export function toDateKey(parts: DateParts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  });
}

/** Suma días (o resta) con desborde de mes/año correcto. */
export function addDaysKey(value: string, days: number): string {
  const parts = parseDateKey(value);
  if (!parts) return value;
  const next = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return toDateKey({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
}

/** Suma meses conservando el día cuando existe y, si no, el último del mes (31 ene + 1 → 28 feb). */
export function addMonthsKey(value: string, months: number): string {
  const parts = parseDateKey(value);
  if (!parts) return value;
  const index = parts.year * 12 + (parts.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return toDateKey({
    year,
    month,
    day: Math.min(parts.day, daysInMonth(year, month)),
  });
}

export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function clampKey(value: string, min?: string, max?: string): string {
  if (min && compareKeys(value, min) < 0) return min;
  if (max && compareKeys(value, max) > 0) return max;
  return value;
}

export function isDisabledKey(value: string, min?: string, max?: string) {
  return (
    (min !== undefined && min !== '' && compareKeys(value, min) < 0) ||
    (max !== undefined && max !== '' && compareKeys(value, max) > 0)
  );
}

/** Índice de día de la semana con lunes = 0 … domingo = 6. */
export function weekdayIndex(value: string): number {
  const parts = parseDateKey(value);
  if (!parts) return 0;
  const weekday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();
  return (weekday + 6) % 7;
}

export interface CalendarCell {
  key: string;
  day: number;
  inMonth: boolean;
}

/** Grilla de 6 semanas (42 celdas) que arranca en lunes e incluye los días de meses vecinos. */
export function buildMonthGrid(year: number, month: number): CalendarCell[] {
  const first = toDateKey({ year, month, day: 1 });
  const lead = weekdayIndex(first);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const key = addDaysKey(first, i - lead);
    const parts = parseDateKey(key)!;
    cells.push({ key, day: parts.day, inMonth: parts.month === month });
  }
  return cells;
}

const monthNames = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
export const weekdayShort = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'];
export const weekdayLong = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
];

export function monthTitle(year: number, month: number): string {
  return `${monthNames[month - 1]} de ${year}`;
}

/** `05/11/2026`: el formato que el usuario ve (es-AR). */
export function formatDateKey(value: string | null | undefined): string {
  const parts = parseDateKey(value);
  return parts
    ? `${pad(parts.day)}/${pad(parts.month)}/${pad(parts.year, 4)}`
    : '';
}

/** `jueves 5 de noviembre de 2026`, para lectores de pantalla. */
export function describeDateKey(value: string): string {
  const parts = parseDateKey(value);
  if (!parts) return '';
  return `${weekdayLong[weekdayIndex(value)]} ${parts.day} de ${monthNames[parts.month - 1]} de ${parts.year}`;
}

// ───────── Fecha y hora ─────────

export interface TimeParts {
  hour: number;
  minute: number;
}

export function splitDateTime(value: string | null | undefined): {
  date: string;
  time: TimeParts | null;
} {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(
    value ?? '',
  );
  if (!match) return { date: '', time: null };
  return {
    date: match[1]!,
    time:
      match[2] !== undefined
        ? { hour: Number(match[2]), minute: Number(match[3]) }
        : null,
  };
}

export function joinDateTime(date: string, time: TimeParts | null): string {
  if (!date) return '';
  const t = time ?? { hour: 0, minute: 0 };
  return `${date}T${pad(t.hour)}:${pad(t.minute)}`;
}

export function clampTimePart(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}

/** Sube o baja una parte de la hora con vuelta (23 → 00, 00 → 23). */
export function stepTimePart(value: number, delta: number, size: number) {
  return (((value + delta) % size) + size) % size;
}

export function formatDateTimeKey(value: string | null | undefined): string {
  const { date, time } = splitDateTime(value);
  if (!date) return '';
  return time
    ? `${formatDateKey(date)} ${pad(time.hour)}:${pad(time.minute)}`
    : formatDateKey(date);
}

/** Teclas de navegación del calendario → fecha destino (patrón «date picker dialog» de WAI-ARIA). */
export function dateForKey(
  current: string,
  key: string,
  shift = false,
): string | null {
  switch (key) {
    case 'ArrowLeft':
      return addDaysKey(current, -1);
    case 'ArrowRight':
      return addDaysKey(current, 1);
    case 'ArrowUp':
      return addDaysKey(current, -7);
    case 'ArrowDown':
      return addDaysKey(current, 7);
    case 'PageUp':
      return addMonthsKey(current, shift ? -12 : -1);
    case 'PageDown':
      return addMonthsKey(current, shift ? 12 : 1);
    case 'Home': {
      const offset = buildMonthGrid(
        parseDateKey(current)!.year,
        parseDateKey(current)!.month,
      ).findIndex((cell) => cell.key === current);
      return addDaysKey(current, -(offset % 7));
    }
    case 'End': {
      const offset = buildMonthGrid(
        parseDateKey(current)!.year,
        parseDateKey(current)!.month,
      ).findIndex((cell) => cell.key === current);
      return addDaysKey(current, 6 - (offset % 7));
    }
    default:
      return null;
  }
}
