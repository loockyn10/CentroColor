import { describe, expect, it } from 'vitest';
import type { TrashEntityType, TrashItem } from '@centrocolor/domain';
import {
  describeTrashItem,
  listTrash,
  restoreItem,
  trashItem,
  type TrashRepository,
} from './trash';

/** Repositorio en memoria con la misma semántica que Web y Desktop: sólo marca `deleted_at`. */
class MemoryTrash implements TrashRepository {
  rows = new Map<
    string,
    {
      type: TrashEntityType;
      id: string;
      name: string;
      isActive: boolean;
      deletedAt: string | null;
    }
  >();
  add(type: TrashEntityType, id: string, name: string, isActive = true) {
    this.rows.set(`${type}:${id}`, {
      type,
      id,
      name,
      isActive,
      deletedAt: null,
    });
  }
  /** Listado normal de un catálogo: lo eliminado no aparece; lo inactivo sí. */
  catalog(type: TrashEntityType) {
    return [...this.rows.values()].filter(
      (x) => x.type === type && !x.deletedAt,
    );
  }
  async list(): Promise<TrashItem[]> {
    return [...this.rows.values()]
      .filter((x) => x.deletedAt)
      .map((x) => ({
        type: x.type,
        id: x.id,
        name: x.name,
        detail: null,
        deletedAt: x.deletedAt!,
      }));
  }
  async trash(_business: string, type: TrashEntityType, id: string) {
    const row = this.rows.get(`${type}:${id}`);
    if (!row || row.deletedAt) throw new Error('No se encontró el elemento.');
    row.deletedAt = new Date(2026, 10, 5, 10, this.rows.size).toISOString();
  }
  async restore(_business: string, type: TrashEntityType, id: string) {
    const row = this.rows.get(`${type}:${id}`);
    if (!row || !row.deletedAt) throw new Error('No se encontró el elemento.');
    row.deletedAt = null;
  }
}

describe('casos de uso de la Papelera', () => {
  it('una entidad eliminada desaparece del listado normal y aparece en la Papelera', async () => {
    const repo = new MemoryTrash();
    repo.add('product', 'p1', 'Producto prueba 123');
    repo.add('product', 'p2', 'Álbum');
    await trashItem(repo, 'b', 'product', 'p1');
    expect(repo.catalog('product').map((x) => x.id)).toEqual(['p2']);
    expect((await listTrash(repo, 'b')).map((x) => x.id)).toEqual(['p1']);
  });

  it('eliminado ≠ inactivo: un inactivo sigue en su listado y no está en la Papelera', async () => {
    const repo = new MemoryTrash();
    repo.add('resource', 'r1', 'Proyector', false);
    expect(repo.catalog('resource')).toHaveLength(1);
    expect(await listTrash(repo, 'b')).toEqual([]);
    await trashItem(repo, 'b', 'resource', 'r1');
    expect(repo.catalog('resource')).toEqual([]);
    // Eliminar no lo reactivó ni lo desactivó: conserva su estado.
    expect(repo.rows.get('resource:r1')!.isActive).toBe(false);
  });

  it('restaurar vuelve a mostrarlo en su listado', async () => {
    const repo = new MemoryTrash();
    repo.add('product_category', 'c1', 'Marcos');
    await trashItem(repo, 'b', 'product_category', 'c1');
    expect(repo.catalog('product_category')).toEqual([]);
    await restoreItem(repo, 'b', 'product_category', 'c1');
    expect(repo.catalog('product_category').map((x) => x.id)).toEqual(['c1']);
    expect(await listTrash(repo, 'b')).toEqual([]);
  });

  it('no permite eliminar dos veces ni restaurar lo que no está eliminado', async () => {
    const repo = new MemoryTrash();
    repo.add('product', 'p1', 'Álbum');
    await expect(restoreItem(repo, 'b', 'product', 'p1')).rejects.toThrow();
    await trashItem(repo, 'b', 'product', 'p1');
    await expect(trashItem(repo, 'b', 'product', 'p1')).rejects.toThrow();
  });

  it('rechaza tipos que deliberadamente no usan Papelera (ventas, pagos, movimientos)', async () => {
    const repo = new MemoryTrash();
    for (const type of ['sale', 'work_payment', 'stock_movement', 'customer']) {
      await expect(
        trashItem(repo, 'b', type as TrashEntityType, 'x'),
      ).rejects.toThrow('no usa la Papelera');
      await expect(
        restoreItem(repo, 'b', type as TrashEntityType, 'x'),
      ).rejects.toThrow('no usa la Papelera');
    }
  });

  it('la Papelera lista lo más reciente primero y describe el tipo', async () => {
    const repo = new MemoryTrash();
    repo.add('product', 'a', 'A');
    repo.add('event_type', 'b', 'B');
    await trashItem(repo, 'biz', 'product', 'a');
    await trashItem(repo, 'biz', 'event_type', 'b');
    const items = await listTrash(repo, 'biz');
    expect(items.map((x) => x.id)).toEqual(['b', 'a']);
    expect(
      describeTrashItem({
        type: 'product',
        id: 'a',
        name: 'A',
        detail: '777',
        deletedAt: 'x',
      }),
    ).toBe('Producto · 777');
    expect(
      describeTrashItem({
        type: 'resource',
        id: 'a',
        name: 'A',
        detail: null,
        deletedAt: 'x',
      }),
    ).toBe('Recurso');
  });
});
