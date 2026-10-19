import { describe, expect, it } from 'vitest';

const raw = import.meta.glob(['./*.ts', './*.tsx', '!./*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const all = Object.values(raw).join(' ');
const file = (name: string) => raw[`./${name}`] ?? '';

describe('regla comercial del portal público (DESIGN-02, no reinterpretar)', () => {
  it('/imprimir no tiene casilla de WhatsApp', () => {
    expect(file('print-order-portal.tsx')).not.toMatch(/type="checkbox"/);
    expect(all).not.toMatch(/po-consent|Quiero recibir por WhatsApp/);
  });

  it('muestra alias, copiar alias y la regla de acreditación', () => {
    expect(all).toContain("'CENTROCOLORESPERANZA'");
    expect(file('print-order-portal.tsx')).toContain('Copiar alias');
    expect(file('print-order-portal.tsx')).toContain('PRINT_AFTER_PAYMENT');
    expect(file('order-tracking.tsx')).toContain('BANK_ALIAS');
    expect(all).toContain(
      'La impresión se realiza una vez acreditado el pago.',
    );
  });

  it('no queda ninguna modalidad de pago en el local', () => {
    expect(all).not.toMatch(
      /pago se realiza en el local|al retirar tu pedido|PAYMENT_MODE/i,
    );
  });
});
