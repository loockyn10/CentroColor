import type { StatusTone } from '@centrocolor/ui';

/** Etiqueta y tono de cada estado, según la tabla única de docs/UX_GRAMMAR.md. */
export interface StatusMeta {
  label: string;
  tone: StatusTone;
}

export const plotterQuoteStatus: Record<string, StatusMeta> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  quoted: { label: 'Cotizada', tone: 'info' },
  accepted: { label: 'Aceptada', tone: 'progress' },
  completed: { label: 'Completada', tone: 'ok' },
  cancelled: { label: 'Cancelada', tone: 'closed' },
};

export const frameJobStatus: Record<string, StatusMeta> = {
  pending: { label: 'Pendiente', tone: 'neutral' },
  in_progress: { label: 'En proceso', tone: 'progress' },
  ready: { label: 'Listo', tone: 'ok' },
  delivered: { label: 'Entregado', tone: 'closed' },
  cancelled: { label: 'Cancelado', tone: 'closed' },
};

/** Producción: «Pendiente» rotula el estado `received` sólo en esta vista; el estado de dominio no cambia. */
export const productionJobStatus: Record<string, StatusMeta> = {
  received: { label: 'Pendiente', tone: 'neutral' },
  in_progress: { label: 'En proceso', tone: 'progress' },
  ready: { label: 'Listo', tone: 'ok' },
};

export const appointmentStatus: Record<string, StatusMeta> = {
  scheduled: { label: 'Programado', tone: 'info' },
  completed: { label: 'Completado', tone: 'ok' },
  cancelled: { label: 'Cancelado', tone: 'closed' },
  no_show: { label: 'Ausente', tone: 'alert' },
};

export const eventStatus: Record<string, StatusMeta> = {
  inquiry: { label: 'Consulta', tone: 'neutral' },
  quoted: { label: 'Presupuestado', tone: 'info' },
  reserved: { label: 'Reservado', tone: 'progress' },
  completed: { label: 'Realizado', tone: 'ok' },
  cancelled: { label: 'Cancelado', tone: 'closed' },
};

/** Estado de un pedido de laboratorio fuera de Producción (Pedidos, ficha de cliente). */
export const photoJobStatus: Record<string, StatusMeta> = {
  received: { label: 'Recibido', tone: 'neutral' },
  in_progress: { label: 'En proceso', tone: 'progress' },
  ready: { label: 'Listo para entregar', tone: 'ok' },
  delivered: { label: 'Entregado', tone: 'closed' },
  cancelled: { label: 'Cancelado', tone: 'closed' },
};

/** Estado del origen de una deuda (pedido, reserva o trabajo de marquetería). */
export const workSourceStatus: Record<string, StatusMeta> = {
  ...photoJobStatus,
  pending: { label: 'Pendiente', tone: 'neutral' },
  inquiry: { label: 'Consulta', tone: 'neutral' },
  quoted: { label: 'Presupuestado', tone: 'info' },
  reserved: { label: 'Reservado', tone: 'progress' },
  completed: { label: 'Realizado', tone: 'ok' },
};

export const statusMeta = (
  table: Record<string, StatusMeta>,
  status: string,
): StatusMeta => table[status] ?? { label: status, tone: 'neutral' };
