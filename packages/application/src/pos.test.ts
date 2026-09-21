import { describe, expect, it } from 'vitest';
import type {
  Product,
  ProductCategory,
  ProductDetails,
  Sale,
  SaleItem,
} from '@centrocolor/domain';
import { cartTotal, parsePaymentMethod } from '@centrocolor/domain';
import {
  addToCart,
  completeSale,
  createProduct,
  removeFromCart,
  scanBarcode,
  setCartQuantity,
  type ProductRepository,
  type SaleRepository,
} from './pos';

class MemoryProducts implements ProductRepository {
  rows: Product[] = [];
  lookups: string[] = [];
  async list(businessId: string, query: string, limit: number) {
    return this.rows
      .filter(
        (row) =>
          row.businessId === businessId &&
          (row.name.includes(query) || row.barcode?.includes(query)),
      )
      .slice(0, limit);
  }
  async findByBarcode(businessId: string, barcode: string) {
    this.lookups.push(barcode);
    return (
      this.rows.find(
        (row) => row.businessId === businessId && row.barcode === barcode,
      ) ?? null
    );
  }
  async create(product: Product) {
    if (
      product.barcode &&
      this.rows.some(
        (row) =>
          row.businessId === product.businessId &&
          row.barcode === product.barcode,
      )
    )
      throw new Error('barcode duplicado');
    this.rows.push(product);
    return product;
  }
  async update(businessId: string, id: string, details: ProductDetails) {
    const row = this.rows.find(
      (item) => item.businessId === businessId && item.id === id,
    )!;
    Object.assign(row, details);
    return row;
  }
  async setActive(businessId: string, id: string, active: boolean) {
    const row = this.rows.find(
      (item) => item.businessId === businessId && item.id === id,
    )!;
    row.isActive = active;
    return row;
  }
  async listCategories(): Promise<ProductCategory[]> {
    return [];
  }
  async createCategory(category: ProductCategory) {
    return category;
  }
}

const details = (barcode: string | null): ProductDetails => ({
  name: 'Álbum negro',
  barcode,
  salePriceCents: 1299,
  costPriceCents: null,
  categoryId: null,
});
const context = {
  businessId: 'business-a',
  branchId: 'branch-a',
  deviceId: null,
  userId: 'user-a',
};

describe('POS use cases', () => {
  it('accepts products without barcodes and scopes duplicate barcodes by business', async () => {
    const products = new MemoryProducts();
    await createProduct(products, 'business-a', details(null));
    await createProduct(products, 'business-a', details(null));
    await createProduct(products, 'business-a', details('779123'));
    await expect(
      createProduct(products, 'business-a', details('779123')),
    ).rejects.toThrow('duplicado');
    await createProduct(products, 'business-b', details('779123'));
    expect(products.rows).toHaveLength(4);
  });

  it('looks up an exact normalized barcode, adds and increments one line', async () => {
    const products = new MemoryProducts();
    const product = await createProduct(
      products,
      'business-a',
      details('779123'),
    );
    expect(await scanBarcode(products, 'business-a', ' 779123\n')).toEqual({
      kind: 'found',
      product,
    });
    expect(products.lookups).toEqual(['779123']);
    expect(await scanBarcode(products, 'business-a', '779')).toEqual({
      kind: 'unknown',
      barcode: '779',
    });
    expect(await scanBarcode(products, 'business-b', '779123')).toEqual({
      kind: 'unknown',
      barcode: '779123',
    });
    let cart = addToCart([], product);
    cart = addToCart(cart, product);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({
      quantity: 2,
      unitPriceCents: 1299,
      lineTotalCents: 2598,
    });
  });

  it('preserves the scanned barcode through quick create and adds the new product', async () => {
    const products = new MemoryProducts();
    const scan = await scanBarcode(products, 'business-a', ' 779456 ');
    expect(scan.kind).toBe('unknown');
    if (scan.kind !== 'unknown') return;
    const created = await createProduct(products, 'business-a', {
      ...details(scan.barcode),
      name: 'Nuevo',
    });
    const cart = addToCart([], created);
    expect(cart[0]).toMatchObject({ barcode: '779456', productName: 'Nuevo' });
    expect(await scanBarcode(products, 'business-a', scan.barcode)).toEqual({
      kind: 'found',
      product: created,
    });
  });

  it('calculates integer cents and safely changes or removes quantities', async () => {
    const product = await createProduct(
      new MemoryProducts(),
      'business-a',
      details(null),
    );
    let cart = addToCart([], product);
    cart = setCartQuantity(cart, product.id, 3);
    expect(cartTotal(cart)).toBe(3897);
    cart = setCartQuantity(cart, product.id, 2);
    expect(cartTotal(cart)).toBe(2598);
    expect(() => setCartQuantity(cart, product.id, 0)).toThrow('cantidad');
    expect(removeFromCart(cart, product.id)).toEqual([]);
  });

  it('rejects empty checkout and invalid payment; snapshots do not change with Product', async () => {
    const products = new MemoryProducts();
    const product = await createProduct(products, 'business-a', details('779'));
    const saved: { sale: Sale; items: SaleItem[] }[] = [];
    const sales: SaleRepository = {
      complete: async (sale, items) => {
        saved.push({
          sale: structuredClone(sale),
          items: structuredClone(items),
        });
      },
      list: async () => saved.map((entry) => entry.sale),
      get: async (_businessId, id) =>
        saved.find((entry) => entry.sale.id === id) ?? null,
    };
    await expect(completeSale(sales, context, [], 'cash')).rejects.toThrow(
      'producto',
    );
    expect(() => parsePaymentMethod('bitcoin')).toThrow('Forma de pago');
    await expect(
      completeSale(sales, context, addToCart([], product), 'bitcoin'),
    ).rejects.toThrow('Forma de pago');
    const sale = await completeSale(
      sales,
      context,
      addToCart([], product),
      'debit',
    );
    expect(sale.totalCents).toBe(1299);
    expect(saved[0].items[0]).toMatchObject({
      productName: 'Álbum negro',
      barcode: '779',
      unitPriceCents: 1299,
      totalCents: 1299,
    });
    await products.update(context.businessId, product.id, {
      ...details('779'),
      name: 'Renombrado',
      salePriceCents: 9999,
    });
    expect(saved[0].items[0].productName).toBe('Álbum negro');
    expect(saved[0].items[0].unitPriceCents).toBe(1299);
  });

  it('propagates persistence failure so the caller can retain the cart', async () => {
    const product = await createProduct(
      new MemoryProducts(),
      'business-a',
      details(null),
    );
    const cart = addToCart([], product);
    const failure: SaleRepository = {
      complete: async () => {
        throw new Error('database busy');
      },
      list: async () => [],
      get: async () => null,
    };
    await expect(completeSale(failure, context, cart, 'cash')).rejects.toThrow(
      'database busy',
    );
    expect(cart).toHaveLength(1);
  });
});
