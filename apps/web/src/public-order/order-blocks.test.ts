import { describe, expect, it } from 'vitest';
import {
  addBlock,
  canAddBlock,
  catalogSizes,
  changeBlock,
  freePapers,
  orderedUploadIds,
  prettySize,
  removeBlock,
} from './order-blocks';
import {
  deriveLines,
  missingForConfirm,
  orderTotal,
  startBody,
  type CatalogService,
  type PhotoEntry,
} from './model';

const tiers = (first: number, bulk: number) => [
  { minQuantity: 1, maxQuantity: 9, unitPriceCents: first },
  { minQuantity: 10, maxQuantity: null, unitPriceCents: bulk },
];

// The catalog as the server now sends it: each size on each paper it really sells.
const svc = (
  id: string,
  photoServiceId: string,
  size: string,
  paper: 'glossy' | 'matte',
  first: number,
  bulk: number,
  mm: [number, number],
): CatalogService => ({
  id,
  variantId: `v-${id}`,
  photoServiceId,
  sizeName: size,
  paper,
  paperLabel: paper === 'glossy' ? 'Brillo' : 'Mate',
  name: `${size} · ${paper === 'glossy' ? 'Brillo' : 'Mate'}`,
  description: null,
  widthMm: mm[0],
  heightMm: mm[1],
  unitPriceCents: first,
  tiers: tiers(first, bulk),
});

const catalog: CatalogService[] = [
  svc('p1015', 'p1015', '10x15', 'glossy', 50000, 40000, [100, 150]),
  svc('m1015', 'p1015', '10x15', 'matte', 55000, 45000, [100, 150]),
  svc('p1318', 'p1318', '13x18', 'glossy', 80000, 70000, [130, 180]),
  svc('m1318', 'p1318', '13x18', 'matte', 85000, 75000, [130, 180]),
  svc('p2030', 'p2030', '20x30', 'glossy', 250000, 220000, [200, 300]),
];

const file = (name: string) => ({ name, size: 10 }) as File;
const entry = (id: string, serviceId: string, copies: number): PhotoEntry => ({
  id,
  serviceId,
  file: file(`${id}.jpg`),
  copies,
});
const customer = {
  name: 'Ana Pérez',
  phone: '342 555 1234',
  email: '',
  notes: '',
  whatsappOptIn: true,
};

describe('tamaños y papeles salen del catálogo', () => {
  it('agrupa por tamaño y ofrece sólo los papeles que ese tamaño realmente tiene', () => {
    const sizes = catalogSizes(catalog);
    expect(sizes.map((x) => x.name)).toEqual(['10x15', '13x18', '20x30']);
    expect(sizes.map((x) => x.papers.map((p) => p.label))).toEqual([
      ['Brillo', 'Mate'],
      ['Brillo', 'Mate'],
      ['Brillo'],
    ]);
    expect(sizes[2]!.papers.map((p) => p.service.id)).toEqual(['p2030']);
  });

  it('un tamaño sin variantes activas no aparece; uno nuevo aparece sin tocar código', () => {
    const without = catalog.filter((x) => x.photoServiceId !== 'p1318');
    expect(catalogSizes(without).map((x) => x.name)).toEqual([
      '10x15',
      '20x30',
    ]);
    const extra = svc(
      'p1521',
      'p1521',
      '15x21',
      'glossy',
      120000,
      100000,
      [150, 210],
    );
    expect(catalogSizes([...catalog, extra]).map((x) => x.name)).toContain(
      '15x21',
    );
  });

  it('con un servidor que todavía no separa tamaño y papel, lo deduce del nombre', () => {
    const legacy: CatalogService[] = catalog.map(
      ({ photoServiceId, sizeName, paper, paperLabel, ...rest }) => {
        void photoServiceId;
        void sizeName;
        void paper;
        void paperLabel;
        return rest;
      },
    );
    const sizes = catalogSizes(legacy);
    expect(sizes.map((x) => x.name)).toEqual(['10x15', '13x18', '20x30']);
    expect(sizes[0]!.papers.map((p) => p.label)).toEqual(['Brillo', 'Mate']);
    // Un servicio heredado sin papel es un tamaño de una sola opción.
    const single = catalogSizes([
      {
        ...catalog[0]!,
        name: '10x15',
        sizeName: undefined,
        paperLabel: undefined,
        photoServiceId: undefined,
        paper: undefined,
      },
    ]);
    expect(single[0]!.papers).toHaveLength(1);
  });

  it('muestra 10×15 con el signo de multiplicar sin cambiar el nombre guardado', () => {
    expect(prettySize('10x15 · Brillo')).toBe('10×15 · Brillo');
    expect(catalog[0]!.name).toBe('10x15 · Brillo');
  });
});

describe('bloques independientes', () => {
  it('no se puede crear dos bloques idénticos; el mismo tamaño admite papeles distintos', () => {
    let selected = addBlock([], 'p1015');
    selected = addBlock(selected, 'p1015');
    expect(selected).toEqual(['p1015']);
    selected = addBlock(selected, 'm1015');
    expect(selected).toEqual(['p1015', 'm1015']);
    const size = catalogSizes(catalog)[0]!;
    expect(freePapers(size, selected)).toEqual([]);
    expect(freePapers(size, ['p1015']).map((x) => x.label)).toEqual(['Mate']);
  });

  it('deja de ofrecer «agregar otro» cuando ya están todas las combinaciones', () => {
    const sizes = catalogSizes(catalog);
    expect(canAddBlock(sizes, [])).toBe(true);
    expect(
      canAddBlock(
        sizes,
        catalog.map((x) => x.id),
      ),
    ).toBe(false);
    expect(
      canAddBlock(
        sizes,
        catalog.slice(1).map((x) => x.id),
      ),
    ).toBe(true);
  });

  it('agregar otro formato no pierde las fotos ni las cantidades del anterior', () => {
    const entries = [entry('a', 'p1015', 3), entry('b', 'p1015', 1)];
    const selected = addBlock(['p1015'], 'm1318');
    const lines = deriveLines(catalog, selected, [
      ...entries,
      entry('c', 'm1318', 2),
    ]);
    expect(lines.map((l) => [l.service.id, l.files, l.copies])).toEqual([
      ['p1015', 2, 4],
      ['m1318', 1, 2],
    ]);
  });

  it('los bloques quedan en el orden en que se agregaron, no en el del catálogo', () => {
    const lines = deriveLines(
      catalog,
      ['p2030', 'p1015'],
      [entry('a', 'p2030', 1), entry('b', 'p1015', 1)],
    );
    expect(lines.map((l) => l.service.id)).toEqual(['p2030', 'p1015']);
  });

  it('cambiar tamaño o papel conserva todas las fotos, sus copias y el lugar del bloque', () => {
    const state = {
      selected: ['p1015', 'p1318'],
      entries: [
        entry('a', 'p1015', 3),
        entry('b', 'p1015', 1),
        entry('c', 'p1318', 2),
      ],
    };
    const next = changeBlock(state, 'p1015', 'm1015');
    expect(next.selected).toEqual(['m1015', 'p1318']);
    expect(next.entries.map((x) => [x.id, x.serviceId, x.copies])).toEqual([
      ['a', 'm1015', 3],
      ['b', 'm1015', 1],
      ['c', 'p1318', 2],
    ]);
    // El precio se recalcula con el papel nuevo; las fotos siguen siendo las mismas.
    const [first] = deriveLines(catalog, next.selected, next.entries);
    expect(first!.files).toBe(2);
    expect(first!.unitPriceCents).toBe(55000);
  });

  it('cambiar a una combinación que ya es otro bloque no hace nada', () => {
    const state = {
      selected: ['p1015', 'm1015'],
      entries: [entry('a', 'p1015', 1), entry('b', 'm1015', 1)],
    };
    expect(changeBlock(state, 'p1015', 'm1015')).toBe(state);
    expect(changeBlock(state, 'p1015', 'p1015')).toBe(state);
  });

  it('quitar un bloque quita sus fotos y deja intactos a los demás', () => {
    const state = {
      selected: ['p1015', 'm1318'],
      entries: [entry('a', 'p1015', 3), entry('b', 'm1318', 5)],
    };
    const next = removeBlock(state, 'p1015');
    expect(next.selected).toEqual(['m1318']);
    expect(next.entries.map((x) => [x.id, x.copies])).toEqual([['b', 5]]);
    expect(removeBlock(next, 'm1318')).toEqual({ selected: [], entries: [] });
  });
});

describe('precio y total con varios bloques', () => {
  it('cada bloque usa el tramo de sus propias copias; el total es la suma', () => {
    const entries = [
      entry('a', 'p1015', 6),
      entry('b', 'p1015', 4), // 10 copias → tramo 10+
      entry('c', 'm1318', 2),
    ];
    const lines = deriveLines(catalog, ['p1015', 'm1318'], entries);
    expect(lines[0]).toMatchObject({
      copies: 10,
      unitPriceCents: 40000,
      totalCents: 400000,
    });
    expect(lines[1]).toMatchObject({
      copies: 2,
      unitPriceCents: 85000,
      totalCents: 170000,
    });
    expect(orderTotal(lines)).toBe(570000);
  });

  it('cambiar la cantidad de una foto cambia el tramo y el total al instante', () => {
    const before = deriveLines(
      catalog,
      ['p1015'],
      [entry('a', 'p1015', 9)],
    )[0]!;
    const after = deriveLines(
      catalog,
      ['p1015'],
      [entry('a', 'p1015', 10)],
    )[0]!;
    expect(before.unitPriceCents).toBe(50000);
    expect(after.unitPriceCents).toBe(40000);
    expect(after.totalCents).toBe(400000);
  });

  it('el pedido enviado al servidor lleva un ítem por bloque con su papel y la cantidad derivada', () => {
    const lines = deriveLines(
      catalog,
      ['p1015', 'm1015'],
      [entry('a', 'p1015', 3), entry('b', 'm1015', 2)],
    );
    const body = startBody('k'.repeat(24), customer, lines);
    expect(body.items).toEqual([
      { serviceId: 'p1015', quantity: 3, variantId: 'v-p1015' },
      { serviceId: 'm1015', quantity: 2, variantId: 'v-m1015' },
    ]);
    expect(body.expectedTotalCents).toBe(3 * 50000 + 2 * 55000);
  });

  it('no deja confirmar un pedido sin fotos ni un bloque vacío', () => {
    expect(missingForConfirm([], [], customer)).toEqual([
      'elegí al menos un tamaño',
    ]);
    const lines = deriveLines(
      catalog,
      ['p1015', 'm1318'],
      [entry('a', 'p1015', 1)],
    );
    expect(missingForConfirm(lines, ['p1015', 'm1318'], customer)).toEqual([
      'agregá fotos de 13x18 · Mate',
    ]);
  });
});

describe('fotos que forman el pedido, en el orden que ve el cliente', () => {
  it('lista los intentos bloque por bloque y foto por foto', () => {
    const sent = [
      entry('c', 'm1318', 1),
      entry('a', 'p1015', 1),
      entry('b', 'p1015', 1),
    ];
    const attempts = new Map([
      ['a', 'u-a'],
      ['b', 'u-b'],
      ['c', 'u-c'],
    ]);
    expect(orderedUploadIds(['p1015', 'm1318'], sent, attempts)).toEqual([
      'u-a',
      'u-b',
      'u-c',
    ]);
    expect(orderedUploadIds(['m1318', 'p1015'], sent, attempts)).toEqual([
      'u-c',
      'u-a',
      'u-b',
    ]);
  });

  it('si falta el rastro de una foto no manda lista: así el servidor no retira nada por error', () => {
    const sent = [entry('a', 'p1015', 1), entry('b', 'p1015', 1)];
    expect(
      orderedUploadIds(['p1015'], sent, new Map([['a', 'u-a']])),
    ).toBeNull();
    expect(
      orderedUploadIds([], [entry('a', 'p1015', 1)], new Map([['a', 'u-a']])),
    ).toBeNull();
  });
});
