import {
  cartTotal,
  lineTotal,
  normalizeBarcode,
  normalizeCategoryName,
  normalizeProductDetails,
  parsePaymentMethod,
  type CartLine,
  type PaymentMethod,
  type Product,
  type ProductCategory,
  type ProductDetails,
  type Sale,
  type SaleItem,
} from '@centrocolor/domain';

export interface ProductRepository {
  list(businessId: string, query: string, limit: number): Promise<Product[]>;
  findByBarcode(businessId: string, barcode: string): Promise<Product | null>;
  create(product: Product): Promise<Product>;
  update(
    businessId: string,
    id: string,
    details: ProductDetails,
  ): Promise<Product>;
  setActive(businessId: string, id: string, active: boolean): Promise<Product>;
  listCategories(businessId: string): Promise<ProductCategory[]>;
  createCategory(category: ProductCategory): Promise<ProductCategory>;
}

export interface SaleRepository {
  complete(sale: Sale, items: SaleItem[]): Promise<void>;
  list(businessId: string, limit: number): Promise<Sale[]>;
  get(
    businessId: string,
    id: string,
  ): Promise<{ sale: Sale; items: SaleItem[] } | null>;
}

export function createProduct(
  repository: ProductRepository,
  businessId: string,
  details: ProductDetails,
): Promise<Product> {
  const now = new Date().toISOString();
  return repository.create({
    id: crypto.randomUUID(),
    businessId,
    ...normalizeProductDetails(details),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

export function updateProduct(
  repository: ProductRepository,
  businessId: string,
  id: string,
  details: ProductDetails,
) {
  return repository.update(businessId, id, normalizeProductDetails(details));
}

export function createCategory(
  repository: ProductRepository,
  businessId: string,
  value: string,
) {
  const now = new Date().toISOString();
  return repository.createCategory({
    id: crypto.randomUUID(),
    businessId,
    name: normalizeCategoryName(value),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

export function addToCart(lines: CartLine[], product: Product): CartLine[] {
  if (!product.isActive) throw new Error('El producto está inactivo.');
  const existing = lines.find((line) => line.productId === product.id);
  if (existing)
    return setCartQuantity(lines, product.id, existing.quantity + 1);
  return [
    ...lines,
    {
      productId: product.id,
      productName: product.name,
      barcode: product.barcode,
      unitPriceCents: product.salePriceCents,
      quantity: 1,
      lineTotalCents: lineTotal(product.salePriceCents, 1),
    },
  ];
}

export function setCartQuantity(
  lines: CartLine[],
  productId: string,
  quantity: number,
): CartLine[] {
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    throw new Error('La cantidad debe ser un entero positivo.');
  return lines.map((line) =>
    line.productId === productId
      ? {
          ...line,
          quantity,
          lineTotalCents: lineTotal(line.unitPriceCents, quantity),
        }
      : line,
  );
}

export function removeFromCart(
  lines: CartLine[],
  productId: string,
): CartLine[] {
  return lines.filter((line) => line.productId !== productId);
}

export type ScanResult =
  | { kind: 'found'; product: Product }
  | { kind: 'unknown'; barcode: string }
  | { kind: 'inactive'; product: Product };

export async function scanBarcode(
  repository: ProductRepository,
  businessId: string,
  raw: string,
): Promise<ScanResult> {
  const barcode = normalizeBarcode(raw);
  if (!barcode) throw new Error('Ingresá un código de barras.');
  const product = await repository.findByBarcode(businessId, barcode);
  if (!product) return { kind: 'unknown', barcode };
  return product.isActive
    ? { kind: 'found', product }
    : { kind: 'inactive', product };
}

export async function completeSale(
  repository: SaleRepository,
  context: {
    businessId: string;
    branchId: string | null;
    deviceId: string | null;
    userId: string;
  },
  lines: CartLine[],
  payment: string,
): Promise<Sale> {
  if (lines.length === 0)
    throw new Error('Agregá un producto antes de cobrar.');
  if (!context.branchId) throw new Error('Se requiere una sucursal activa.');
  const paymentMethod: PaymentMethod = parsePaymentMethod(payment);
  const totalCents = cartTotal(lines);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const sale: Sale = {
    id,
    businessId: context.businessId,
    branchId: context.branchId,
    deviceId: context.deviceId,
    createdBy: context.userId,
    status: 'completed',
    subtotalCents: totalCents,
    totalCents,
    paymentMethod,
    createdAt: now,
    updatedAt: now,
  };
  const items: SaleItem[] = lines.map((line) => ({
    ...line,
    id: crypto.randomUUID(),
    saleId: id,
    totalCents: lineTotal(line.unitPriceCents, line.quantity),
  }));
  await repository.complete(sale, items);
  return sale;
}
