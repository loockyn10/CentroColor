/** Formato compartido por las pantallas del panel (es-AR). */
export const money = (cents: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(
    cents / 100,
  );

export const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export const timeOfDay = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  });

/** «hoy 15:30», «mañana 10:00», «vie 17/10 09:00»: la entrega prometida de un vistazo. */
export function dueText(iso: string | null, now = new Date()) {
  if (!iso) return 'Sin fecha';
  const date = new Date(iso);
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const time = timeOfDay(iso);
  if (days === 0) return `Hoy ${time}`;
  if (days === 1) return `Mañana ${time}`;
  if (days === -1) return `Ayer ${time}`;
  return `${date.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })} ${time}`;
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo completar la operación.';
