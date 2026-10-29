import type { ReactNode } from 'react';

/**
 * Vocabulario único de estados (ver docs/UX_GRAMMAR.md). Cinco tonos más «cerrado»:
 * neutral = pendiente/inicial · progress = en curso · ok = listo/activo · alert = atraso/error ·
 * info = presupuestado/informativo · closed = entregado/cancelado/inactivo.
 */
export type StatusTone =
  'neutral' | 'progress' | 'ok' | 'alert' | 'info' | 'closed';

export function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return <span className={`status status--${tone}`}>{children}</span>;
}
