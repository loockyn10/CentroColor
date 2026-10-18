import { describe, expect, it } from 'vitest';
import { addToCart, scanBarcode } from '@centrocolor/application';
import type { ProductRepository } from '@centrocolor/application';
import type { CartLine, Product } from '@centrocolor/domain';
import { ScanCoordinator } from './scan-coordinator';

function product(id: string, barcode: string, isActive = true): Product {
  return {
    id,
    businessId: 'b1',
    name: `Producto ${id}`,
    barcode,
    salePriceCents: 1000,
    costPriceCents: null,
    categoryId: null,
    isActive,
    tracksInventory: false,
    createdAt: '2026-10-18T00:00:00Z',
    updatedAt: '2026-10-18T00:00:00Z',
  } as Product;
}

/** Repositorio mínimo: el mismo `scanBarcode` que usa el POS, sobre `findByBarcode`. */
function setup(products: Product[], page = 'calendar') {
  const repository = {
    findByBarcode: (_business: string, barcode: string) =>
      Promise.resolve(
        products.find((item) => item.barcode === barcode) ?? null,
      ),
  } as unknown as ProductRepository;
  let active = page;
  const visited: string[] = [];
  const coordinator = new ScanCoordinator({
    lookup: (barcode) => scanBarcode(repository, 'b1', barcode),
    navigate: (target) => {
      visited.push(target);
      active = target;
    },
    activePage: () => active,
  });
  /** Equivale al efecto del POS: retira la cola y aplica `addToCart`. */
  const pos = (cart: CartLine[]) =>
    coordinator
      .takeCartProducts()
      .reduce((lines, item) => addToCart(lines, item), cart);
  return {
    coordinator,
    visited,
    pos,
    setPage: (next: string) => {
      active = next;
    },
  };
}

describe('escáner global: producto conocido', () => {
  it('desde otro módulo navega al POS y suma exactamente 1', async () => {
    const { coordinator, visited, pos } = setup([product('a', '111111')]);
    await coordinator.enqueue('111111');
    expect(visited).toEqual(['new-sale']);
    const cart = pos([]);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ productId: 'a', quantity: 1 });
    expect(pos(cart)).toEqual(cart);
  });

  it('el mismo producto otra vez incrementa la línea (regla del POS)', async () => {
    const { coordinator, pos } = setup([product('a', '111111')]);
    await coordinator.enqueue('111111');
    const once = pos([]);
    await coordinator.enqueue('111111');
    const twice = pos(once);
    expect(twice).toHaveLength(1);
    expect(twice[0]!.quantity).toBe(2);
  });

  it('en el POS no navega y conserva el ticket existente', async () => {
    const { coordinator, visited, pos } = setup(
      [product('a', '111111'), product('b', '222222')],
      'new-sale',
    );
    const existing = addToCart([], product('a', '111111'));
    await coordinator.enqueue('222222');
    expect(visited).toEqual([]);
    expect(pos(existing).map((line) => line.productId)).toEqual(['a', 'b']);
  });

  it('ráfaga A, B, C: se procesan en orden sin perder ni duplicar', async () => {
    const { coordinator, visited, pos } = setup([
      product('a', '111111'),
      product('b', '222222'),
      product('c', '333333'),
    ]);
    await Promise.all(
      ['111111', '222222', '333333', '111111'].map((code) =>
        coordinator.enqueue(code),
      ),
    );
    expect(visited).toEqual(['new-sale']);
    expect(pos([]).map((line) => [line.productId, line.quantity])).toEqual([
      ['a', 2],
      ['b', 1],
      ['c', 1],
    ]);
  });

  it('producto inactivo: aviso y nada en el ticket (igual que el POS)', async () => {
    const { coordinator, visited } = setup([product('a', '111111', false)]);
    await coordinator.enqueue('111111');
    expect(visited).toEqual([]);
    expect(coordinator.getState().cartQueue).toHaveLength(0);
    expect(coordinator.getState().notice?.text).toContain('inactivo');
  });

  it('un error técnico se informa sin romper la cola', async () => {
    const { coordinator, pos } = setup([product('a', '111111')]);
    await coordinator.enqueue('\u0001');
    expect(coordinator.getState().notice).not.toBeNull();
    await coordinator.enqueue('111111');
    expect(pos([])).toHaveLength(1);
  });
});

describe('escáner global: producto desconocido', () => {
  it('abre el alta en Productos con el barcode capturado', async () => {
    const { coordinator, visited } = setup([], 'customers');
    await coordinator.enqueue('999888');
    expect(visited).toEqual(['products']);
    expect(coordinator.getState().alta).toEqual({
      barcode: '999888',
      returnTo: 'customers',
    });
    expect(coordinator.getState().cartQueue).toHaveLength(0);
  });

  it('guardar el alta lleva al POS con el producto nuevo, una sola vez', async () => {
    const { coordinator, visited, pos } = setup([], 'products');
    await coordinator.enqueue('999888');
    expect(visited).toEqual([]);
    const created = product('n', '999888');
    coordinator.finishAlta(created);
    coordinator.finishAlta(created);
    expect(visited).toEqual(['new-sale']);
    expect(coordinator.getState().alta).toBeNull();
    const cart = pos([]);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ productId: 'n', quantity: 1 });
  });

  it('cancelar limpia el código pendiente, no agrega nada y vuelve al módulo previo', async () => {
    const { coordinator, visited, pos, setPage } = setup([], 'calendar');
    await coordinator.enqueue('999888');
    setPage('products');
    coordinator.cancelAlta();
    expect(coordinator.getState().alta).toBeNull();
    expect(visited).toEqual(['products', 'calendar']);
    expect(pos([])).toEqual([]);
    await coordinator.enqueue('555444');
    expect(coordinator.getState().alta?.barcode).toBe('555444');
  });

  it('salir de Productos por cuenta propia descarta el código pendiente', async () => {
    const { coordinator } = setup([], 'agenda');
    await coordinator.enqueue('999888');
    coordinator.pageChanged('products');
    expect(coordinator.getState().alta).not.toBeNull();
    coordinator.pageChanged('stock');
    expect(coordinator.getState().alta).toBeNull();
  });
});
