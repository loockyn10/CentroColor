import { requireCents } from './product';

export const paymentMethods = [
  'cash',
  'debit',
  'credit',
  'transfer',
  'other',
] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export function parsePaymentMethod(value: string): PaymentMethod {
  if (paymentMethods.some((method) => method === value))
    return value as PaymentMethod;
  throw new Error('Forma de pago no válida.');
}

export interface CartLine {
  productId: string;
  productName: string;
  barcode: string | null;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface SaleItem extends Omit<CartLine, 'productId'> {
  id: string;
  saleId: string;
  productId: string | null;
  totalCents: number;
}

export interface Sale {
  id: string;
  businessId: string;
  branchId: string;
  deviceId: string | null;
  createdBy: string;
  status: 'completed';
  subtotalCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
  updatedAt: string;
}

export function lineTotal(unitPriceCents: number, quantity: number): number {
  requireCents(unitPriceCents);
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    throw new Error('La cantidad debe ser un entero positivo.');
  return requireCents(unitPriceCents * quantity);
}

export function cartTotal(lines: CartLine[]): number {
  return requireCents(
    lines.reduce(
      (sum, line) => sum + lineTotal(line.unitPriceCents, line.quantity),
      0,
    ),
  );
}
