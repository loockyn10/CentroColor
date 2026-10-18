import { describe, expect, it } from 'vitest';
import {
  clampCopies,
  deriveLines,
  fileProblem,
  formatMoney,
  lineLabel,
  loadClientKey,
  loadRememberedOrder,
  missingForConfirm,
  newClientKey,
  howItWorks,
  paymentNote,
  PAYMENT_MODE,
  orderTotal,
  rememberOrder,
  startBody,
  trackingHeadline,
  trackingStepIndex,
  trackingSteps,
  type CatalogService,
  type CustomerForm,
  type PhotoEntry,
} from './model';

const service = (
  id: string,
  name: string,
  unitPriceCents: number,
): CatalogService => ({
  id,
  name,
  description: null,
  widthMm: null,
  heightMm: null,
  unitPriceCents,
});
const catalog = [
  service('s10', '10x15', 50000),
  service('s13', '13x18', 80000),
  service('s20', '20x30', 250000),
];
const file = (name: string, size = 1000) => ({ name, size }) as File;
const entry = (
  id: string,
  serviceId: string,
  copies: number,
  name = `${id}.jpg`,
): PhotoEntry => ({ id, serviceId, file: file(name), copies });
const customer: CustomerForm = {
  name: 'María García',
  phone: '342 555 1234',
  email: '',
  notes: '',
  whatsappOptIn: true,
};

describe('cantidades y totales derivados de las fotos', () => {
  it('la cantidad de cada tamaño es la suma de las copias de sus archivos', () => {
    const lines = deriveLines(
      catalog,
      ['s10', 's20'],
      [entry('a', 's10', 2), entry('b', 's10', 1), entry('c', 's20', 1)],
    );
    expect(
      lines.map((x) => [x.service.name, x.files, x.copies, x.totalCents]),
    ).toEqual([
      ['10x15', 2, 3, 150000],
      ['20x30', 1, 1, 250000],
    ]);
    expect(orderTotal(lines)).toBe(400000);
    expect(lines.map((line) => lineLabel(line).replace(/\s/g, ' '))).toEqual([
      '3 × 10x15 = $ 1.500',
      '1 × 20x30 = $ 2.500',
    ]);
  });

  it('ignora fotos de tamaños no elegidos y respeta el orden del catálogo', () => {
    const lines = deriveLines(
      catalog,
      ['s20', 's10'],
      [entry('a', 's13', 5), entry('b', 's20', 1), entry('c', 's10', 1)],
    );
    expect(lines.map((x) => x.service.id)).toEqual(['s10', 's20']);
    expect(orderTotal(lines)).toBe(50000 + 250000);
  });

  it('quitar una foto baja la cantidad; un tamaño sin fotos vale cero', () => {
    const lines = deriveLines(catalog, ['s10'], []);
    expect(lines[0]).toMatchObject({ files: 0, copies: 0, totalCents: 0 });
  });

  it('las copias están acotadas a un entero entre 1 y 99', () => {
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(-5)).toBe(1);
    expect(clampCopies(2.9)).toBe(2);
    expect(clampCopies(1000)).toBe(99);
    expect(clampCopies(Number.NaN)).toBe(1);
  });

  it('formatea pesos sin decimales cuando son enteros', () => {
    expect(formatMoney(50000).replace(/\s/g, '')).toBe('$500');
    expect(formatMoney(150050).replace(/\s/g, '')).toBe('$1.500,50');
  });
});

describe('validación previa a confirmar', () => {
  const lines = deriveLines(catalog, ['s10'], [entry('a', 's10', 1)]);

  it('pide primero lo que falta, en el orden de la pantalla', () => {
    expect(
      missingForConfirm([], [], { ...customer, name: '', phone: '' }),
    ).toEqual(['elegí al menos un tamaño', 'tu nombre', 'tu WhatsApp']);
    const empty = deriveLines(catalog, ['s10', 's20'], [entry('a', 's10', 1)]);
    expect(missingForConfirm(empty, ['s10', 's20'], customer)).toEqual([
      'agregá fotos de 20x30',
    ]);
  });

  it('acepta un pedido completo y rechaza WhatsApp o email evidentemente inválidos', () => {
    expect(missingForConfirm(lines, ['s10'], customer)).toEqual([]);
    expect(
      missingForConfirm(lines, ['s10'], { ...customer, phone: '12 34' }),
    ).toContain('tu WhatsApp');
    expect(
      missingForConfirm(lines, ['s10'], { ...customer, email: 'nope' }),
    ).toContain('un email válido (o dejalo vacío)');
    expect(
      missingForConfirm(lines, ['s10'], { ...customer, email: 'a@b.co' }),
    ).toEqual([]);
  });
});

describe('archivos', () => {
  it('acepta fotos y explica por qué rechaza el resto', () => {
    expect(fileProblem(file('IMG_001.JPG'))).toBeNull();
    expect(fileProblem(file('selfie.heic'))).toBeNull();
    expect(fileProblem(file('doc.pdf'))).toMatch(/sólo se aceptan fotos/);
    expect(fileProblem(file('sin-extension'))).toMatch(/sólo se aceptan fotos/);
    expect(fileProblem(file('vacia.jpg', 0))).toMatch(/vacío/);
  });
});

describe('cuerpo enviado al servidor', () => {
  it('lleva sólo identificadores y cantidades: ningún precio ni total autoritativo', () => {
    const lines = deriveLines(
      catalog,
      ['s10', 's20'],
      [entry('a', 's10', 2), entry('b', 's20', 1)],
    );
    const body = startBody('key-aaaaaaaaaaaaaaaa', customer, lines);
    expect(body).toEqual({
      clientKey: 'key-aaaaaaaaaaaaaaaa',
      customer: {
        name: 'María García',
        phone: '342 555 1234',
        email: undefined,
        notes: undefined,
      },
      whatsappOptIn: true,
      items: [
        { serviceId: 's10', quantity: 2 },
        { serviceId: 's20', quantity: 1 },
      ],
      expectedTotalCents: 350000,
    });
    expect(JSON.stringify(body)).not.toMatch(/unitPrice|unit_price|price/i);
  });
});

describe('claves y memoria del navegador', () => {
  it('genera claves idempotentes válidas y estables entre intentos', () => {
    expect(newClientKey()).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(newClientKey()).not.toBe(newClientKey());
    expect(loadClientKey()).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it('funciona aunque el almacenamiento del navegador no exista o falle', () => {
    expect(() =>
      rememberOrder({
        orderCode: 'CC-1',
        trackingToken: 't'.repeat(43),
        at: 'x',
      }),
    ).not.toThrow();
    expect(loadRememberedOrder()).toBeNull();
  });
});

describe('avance del seguimiento', () => {
  it('muestra cuatro pasos y ubica el estado actual; cancelado no tiene paso', () => {
    expect(trackingSteps.map((x) => x.label)).toEqual([
      'Pedido recibido',
      'En preparación',
      'Listo para retirar',
      'Entregado',
    ]);
    expect(trackingStepIndex('received')).toBe(0);
    expect(trackingStepIndex('in_progress')).toBe(1);
    expect(trackingStepIndex('ready')).toBe(2);
    expect(trackingStepIndex('delivered')).toBe(3);
    expect(trackingStepIndex('cancelled')).toBe(-1);
    expect(trackingHeadline('ready')).toBe('LISTO PARA RETIRAR');
    expect(trackingHeadline('received')).toBe('Pedido recibido');
    expect(trackingHeadline('cancelled')).toBe('Cancelado');
  });
});

describe('pago: sólo se promete lo que el backend hace', () => {
  it('hoy el pago es en el local; la transferencia previa es sólo copy preparado', () => {
    expect(PAYMENT_MODE).toBe('pickup');
    expect(paymentNote).toBe(
      'El pago se realiza en el local al retirar tu pedido.',
    );
    expect(howItWorks.map((step) => step.label)).toEqual([
      'Elegí el tamaño',
      'Subí tus fotos',
      'Confirmá',
      'Retirá en el local',
    ]);
    expect(howItWorks.some((step) => /transfer/i.test(step.label))).toBe(false);
  });
});
