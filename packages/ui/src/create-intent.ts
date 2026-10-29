/**
 * Intención de alta: el menú «Nuevo» la deja anotada y la pantalla destino, al montarse, la toma
 * y abre su formulario. No hay estado compartido más allá de una consulta única.
 */
let pending: string | null = null;

export function requestCreate(viewId: string) {
  pending = viewId;
}

/** Devuelve true una sola vez si había un alta pendiente para esta vista. */
export function takeCreateIntent(viewId: string) {
  if (pending !== viewId) return false;
  pending = null;
  return true;
}
