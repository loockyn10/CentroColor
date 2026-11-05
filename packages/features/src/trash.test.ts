import { describe, expect, it } from 'vitest';
import type { TrashItem } from '@centrocolor/domain';
import { filterTrash } from './trash';

const items: TrashItem[] = [
  {
    type: 'product',
    id: '1',
    name: 'Producto prueba 123',
    detail: '777',
    deletedAt: '2026-11-05T10:00:00Z',
  },
  {
    type: 'product',
    id: '2',
    name: 'Álbum 20x30',
    detail: null,
    deletedAt: '2026-11-04T10:00:00Z',
  },
  {
    type: 'product_category',
    id: '3',
    name: 'Marcos',
    detail: null,
    deletedAt: '2026-11-03T10:00:00Z',
  },
  {
    type: 'resource',
    id: '4',
    name: 'Proyector',
    detail: 'Epson',
    deletedAt: '2026-11-02T10:00:00Z',
  },
];

describe('filtros de la Papelera', () => {
  it('sin filtros devuelve todo (limpiar filtros)', () => {
    expect(filterTrash(items, '', '')).toHaveLength(4);
    expect(filterTrash(items, '   ', '')).toHaveLength(4);
  });
  it('filtra por tipo', () => {
    expect(filterTrash(items, '', 'product').map((x) => x.id)).toEqual([
      '1',
      '2',
    ]);
    expect(filterTrash(items, '', 'resource').map((x) => x.id)).toEqual(['4']);
  });
  it('busca por nombre, detalle y tipo sin distinguir tildes ni mayúsculas', () => {
    expect(filterTrash(items, 'album', '').map((x) => x.id)).toEqual(['2']);
    expect(filterTrash(items, '777', '').map((x) => x.id)).toEqual(['1']);
    expect(filterTrash(items, 'categoria', '').map((x) => x.id)).toEqual(['3']);
    expect(filterTrash(items, 'EPSON', '').map((x) => x.id)).toEqual(['4']);
  });
  it('combina búsqueda y tipo', () => {
    expect(filterTrash(items, 'prueba', 'product').map((x) => x.id)).toEqual([
      '1',
    ]);
    expect(filterTrash(items, 'prueba', 'resource')).toEqual([]);
  });
});
