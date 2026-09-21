import { describe, expect, it, vi } from 'vitest';
import type { CartLine } from '@centrocolor/domain';
import {
  recordStockChange,
  stockWarnings,
  type InventoryRepository,
} from './inventory';

const line = (tracksInventory: boolean, quantity: number): CartLine => ({
  productId: 'p',
  productName: 'Álbum',
  barcode: null,
  unitPriceCents: 100,
  quantity,
  lineTotalCents: quantity * 100,
  tracksInventory,
});

describe('inventario de aplicación', () => {
  it('advierte sin bloquear cuando la cantidad supera el stock, incluido negativo', () => {
    expect(stockWarnings([line(true, 2)], { p: 1 })).toEqual([
      { productId: 'p', productName: 'Álbum', requested: 2, available: 1 },
    ]);
    expect(stockWarnings([line(true, 2)], { p: -1 })).toHaveLength(1);
    expect(stockWarnings([line(false, 2)], { p: 0 })).toEqual([]);
  });

  it('impide cambios manuales a staff y permite owner/admin con enteros', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const repository = { record } as unknown as InventoryRepository;
    const context = {
      businessId: 'b',
      branchId: 'branch',
      role: 'staff' as const,
    };
    expect(() =>
      recordStockChange(repository, context, 'p', 'entry', 2, null),
    ).toThrow();
    expect(record).not.toHaveBeenCalled();
    await expect(
      recordStockChange(
        repository,
        { ...context, role: 'admin' },
        'p',
        'entry',
        2,
        'Reposición',
      ),
    ).resolves.toBeUndefined();
    expect(record.mock.calls[0][0]).toMatchObject({
      businessId: 'b',
      branchId: 'branch',
      productId: 'p',
      movementType: 'entry',
      value: 2,
      note: 'Reposición',
    });
    expect(() =>
      recordStockChange(
        repository,
        { ...context, role: 'owner' },
        'p',
        'adjustment',
        1.5,
        null,
      ),
    ).toThrow();
  });
});
