/**
 * Teclado y búsqueda por letras del `Select` propio (patrón «select-only combobox» de WAI-ARIA).
 * Funciones puras: se prueban sin DOM.
 */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type ListKey =
  'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'PageDown' | 'PageUp';

const enabled = (options: SelectOption[], index: number) =>
  index >= 0 && index < options.length && !options[index]!.disabled;

export function firstEnabled(options: SelectOption[]): number {
  return options.findIndex((option) => !option.disabled);
}

export function lastEnabled(options: SelectOption[]): number {
  for (let i = options.length - 1; i >= 0; i--)
    if (enabled(options, i)) return i;
  return -1;
}

/** Siguiente opción activa para una tecla de navegación; salta las deshabilitadas. */
export function moveActive(
  options: SelectOption[],
  current: number,
  key: ListKey,
): number {
  if (firstEnabled(options) < 0) return -1;
  if (key === 'Home') return firstEnabled(options);
  if (key === 'End') return lastEnabled(options);
  const step = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  if (step !== 0) {
    let i = current;
    do {
      i += step;
    } while (i >= 0 && i < options.length && !enabled(options, i));
    if (i < 0 || i >= options.length)
      return enabled(options, current) ? current : firstEnabled(options);
    return i;
  }
  // PageUp / PageDown: 10 posiciones, acotadas.
  const jump = key === 'PageDown' ? 10 : -10;
  let i = Math.min(options.length - 1, Math.max(0, current + jump));
  while (i >= 0 && i < options.length && !enabled(options, i))
    i += jump > 0 ? -1 : 1;
  return enabled(options, i) ? i : current;
}

const normalize = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');

/**
 * Búsqueda por letras: con el mismo carácter repetido recorre las opciones que empiezan con él;
 * con varios caracteres busca el prefijo completo desde la opción activa.
 */
export function typeahead(
  options: SelectOption[],
  buffer: string,
  current: number,
): number {
  if (!buffer) return current;
  const needle = normalize(buffer);
  const repeated = [...needle].every((char) => char === needle[0]);
  const prefix = repeated ? needle[0]! : needle;
  const order = repeated ? 1 : 0;
  const start = Math.max(current, -1) + order;
  for (let n = 0; n < options.length; n++) {
    const i = (start + n + options.length) % options.length;
    if (enabled(options, i) && normalize(options[i]!.label).startsWith(prefix))
      return i;
  }
  return current;
}

/** Índice inicial al abrir: la opción elegida o la primera disponible. */
export function initialActive(options: SelectOption[], value: string): number {
  const selected = options.findIndex(
    (option) => option.value === value && !option.disabled,
  );
  return selected >= 0 ? selected : firstEnabled(options);
}
