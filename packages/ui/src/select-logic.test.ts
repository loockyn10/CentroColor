import { describe, expect, it } from 'vitest';
import {
  initialActive,
  moveActive,
  typeahead,
  type SelectOption,
} from './select-logic';

const options: SelectOption[] = [
  { value: 'a', label: 'Activo' },
  { value: 'b', label: 'Bloqueado', disabled: true },
  { value: 'c', label: 'Cancelado' },
  { value: 'd', label: 'Cerrado' },
  { value: 'e', label: 'Álbum' },
];

describe('teclado del Select', () => {
  it('↓/↑ saltan opciones deshabilitadas y se detienen en los extremos', () => {
    expect(moveActive(options, 0, 'ArrowDown')).toBe(2);
    expect(moveActive(options, 2, 'ArrowUp')).toBe(0);
    expect(moveActive(options, 0, 'ArrowUp')).toBe(0);
    expect(moveActive(options, 4, 'ArrowDown')).toBe(4);
  });
  it('Inicio/Fin van a la primera y última habilitadas', () => {
    expect(moveActive(options, 2, 'Home')).toBe(0);
    expect(moveActive(options, 0, 'End')).toBe(4);
  });
  it('RePág/AvPág se acotan a la lista', () => {
    expect(moveActive(options, 0, 'PageDown')).toBe(4);
    expect(moveActive(options, 4, 'PageUp')).toBe(0);
  });
  it('sin opciones habilitadas no hay opción activa', () => {
    expect(
      moveActive([{ value: 'x', label: 'X', disabled: true }], -1, 'ArrowDown'),
    ).toBe(-1);
  });
  it('al abrir arranca en la opción elegida o en la primera disponible', () => {
    expect(initialActive(options, 'c')).toBe(2);
    expect(initialActive(options, 'zzz')).toBe(0);
  });
});

describe('búsqueda por letras', () => {
  it('encuentra por prefijo sin distinguir tildes ni mayúsculas', () => {
    expect(typeahead(options, 'al', 0)).toBe(4);
    expect(typeahead(options, 'CE', 0)).toBe(3);
  });
  it('la misma letra repetida recorre las coincidencias', () => {
    expect(typeahead(options, 'c', 0)).toBe(2);
    expect(typeahead(options, 'c', 2)).toBe(3);
    expect(typeahead(options, 'c', 3)).toBe(2);
  });
  it('sin coincidencia conserva la opción actual', () => {
    expect(typeahead(options, 'x', 2)).toBe(2);
  });
});
