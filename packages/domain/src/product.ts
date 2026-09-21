export interface ProductCategory {
  id: string;
  businessId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  businessId: string;
  name: string;
  barcode: string | null;
  salePriceCents: number;
  costPriceCents: number | null;
  categoryId: string | null;
  isActive: boolean;
  tracksInventory: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ProductDetails = Pick<
  Product,
  | 'name'
  | 'barcode'
  | 'salePriceCents'
  | 'costPriceCents'
  | 'categoryId'
  | 'tracksInventory'
>;

export function requireCents(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('El importe debe ser un entero de centavos no negativo.');
  return value;
}

export function normalizeBarcode(value: string | null): string | null {
  const barcode = value?.trim() ?? '';
  if (!barcode) return null;
  if (!/^[\x21-\x7e]{1,128}$/.test(barcode))
    throw new Error('El código de barras contiene caracteres no válidos.');
  return barcode;
}

export function normalizeProductDetails(
  details: ProductDetails,
): ProductDetails {
  const name = details.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('El nombre del producto es obligatorio.');
  return {
    name,
    barcode: normalizeBarcode(details.barcode),
    salePriceCents: requireCents(details.salePriceCents),
    costPriceCents:
      details.costPriceCents === null
        ? null
        : requireCents(details.costPriceCents),
    categoryId: details.categoryId || null,
    tracksInventory: details.tracksInventory === true,
  };
}

export function normalizeCategoryName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('El nombre de la categoría es obligatorio.');
  return name;
}
