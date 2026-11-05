import { describe, expect, it } from 'vitest';
import {
  canManageTrash,
  isDeleted,
  isTrashEntityType,
  sortTrash,
  trashEntityTypes,
  trashTypeLabels,
  withoutDeleted,
  type TrashItem,
} from './trash';

describe('Papelera: eliminado no es inactivo', () => {
  it('un elemento inactivo no está en la Papelera y uno eliminado sigue activo', () => {
    expect(isDeleted({ deletedAt: null })).toBe(false);
    expect(isDeleted({})).toBe(false);
    expect(isDeleted({ deletedAt: '2026-11-05T10:00:00Z' })).toBe(true);
    // `isActive` y `deletedAt` son ejes independientes.
    const inactive = { isActive: false, deletedAt: null };
    const deletedButActive = {
      isActive: true,
      deletedAt: '2026-11-05T10:00:00Z',
    };
    expect(isDeleted(inactive)).toBe(false);
    expect(isDeleted(deletedButActive)).toBe(true);
  });

  it('los listados normales descartan lo eliminado y conservan lo inactivo', () => {
    const rows = [
      { id: 'activo', isActive: true, deletedAt: null },
      { id: 'inactivo', isActive: false, deletedAt: null },
      { id: 'eliminado', isActive: true, deletedAt: '2026-11-05T10:00:00Z' },
      {
        id: 'eliminado-e-inactivo',
        isActive: false,
        deletedAt: '2026-11-04T10:00:00Z',
      },
    ];
    expect(withoutDeleted(rows).map((row) => row.id)).toEqual([
      'activo',
      'inactivo',
    ]);
  });
});

describe('Papelera: tipos y orden', () => {
  it('cada tipo tiene un nombre legible y es reconocible', () => {
    for (const type of trashEntityTypes) {
      expect(trashTypeLabels[type].length).toBeGreaterThan(2);
      expect(isTrashEntityType(type)).toBe(true);
    }
    // Lo que deliberadamente no usa Papelera.
    for (const type of [
      'sale',
      'payment',
      'stock_movement',
      'customer',
      'photo_service',
    ])
      expect(isTrashEntityType(type)).toBe(false);
  });

  it('lo más recientemente eliminado va primero', () => {
    const item = (name: string, deletedAt: string): TrashItem => ({
      type: 'product',
      id: name,
      name,
      detail: null,
      deletedAt,
    });
    const sorted = sortTrash([
      item('viejo', '2026-10-01T00:00:00Z'),
      item('nuevo', '2026-11-05T00:00:00Z'),
      item('medio', '2026-10-20T00:00:00Z'),
    ]);
    expect(sorted.map((x) => x.name)).toEqual(['nuevo', 'medio', 'viejo']);
  });
});

describe('Papelera: permisos', () => {
  it('owner y admin gestionan todo; staff sólo productos y categorías', () => {
    for (const type of trashEntityTypes) {
      expect(canManageTrash('owner', type)).toBe(true);
      expect(canManageTrash('admin', type)).toBe(true);
    }
    expect(canManageTrash('staff', 'product')).toBe(true);
    expect(canManageTrash('staff', 'product_category')).toBe(true);
    expect(canManageTrash('staff', 'resource')).toBe(false);
    expect(canManageTrash('staff', 'appointment_type')).toBe(false);
    expect(canManageTrash('staff', 'frame_moulding')).toBe(false);
  });
});
