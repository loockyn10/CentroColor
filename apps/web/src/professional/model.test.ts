import { describe, expect, it } from 'vitest';
import type {
  CatalogService,
  OrderLine,
  PhotoEntry,
} from '../public-order/model';
import {
  applyCopiesToAll,
  classifyPickedFiles,
  describePick,
  fileKey,
  missingForProfessionalConfirm,
  parseAuthHash,
  passwordProblem,
  pickedFolderName,
  planAdditions,
  PRO_MAX_FILES_PER_ORDER,
  startProfessionalBody,
  summarizeProgress,
  visibleRows,
} from './model';

const file = (name: string, size = 100, path?: string, modified = 1) => {
  const value = new File(['x'.repeat(Math.min(size, 50))], name, {
    lastModified: modified,
  });
  Object.defineProperty(value, 'size', { value: size });
  if (path) Object.defineProperty(value, 'webkitRelativePath', { value: path });
  return value;
};
let counter = 0;
const newId = () => `id-${counter++}`;

describe('clasificar lo que trae una carpeta', () => {
  it('acepta fotos, ignora lo que no lo es y avisa de vacíos y gigantes', () => {
    const picked = classifyPickedFiles([
      file('IMG_1.jpg'),
      file('IMG_2.JPEG'),
      file('foto.heic'),
      file('scan.tif'),
      file('logo.png'),
      file('Boda.lrcat'),
      file('IMG_1.xmp'),
      file('.DS_Store'),
      file('._IMG_1.jpg'),
      file('video.mov'),
      file('vacia.jpg', 0),
      file('enorme.jpg', 301 * 1024 * 1024),
    ]);
    expect(picked.accepted.map((f) => f.name)).toEqual([
      'foto.heic',
      'IMG_1.jpg',
      'IMG_2.JPEG',
      'logo.png',
      'scan.tif',
    ]);
    expect(picked.ignored).toBe(5);
    expect(picked.empty).toEqual(['vacia.jpg']);
    expect(picked.tooLarge).toEqual(['enorme.jpg']);
  });

  it('ordena como lee una persona: IMG_2 antes que IMG_10, subcarpetas incluidas', () => {
    const picked = classifyPickedFiles(
      ['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg', 'IMG_100.jpg'].map((n) =>
        file(n, 10, `Boda/${n}`),
      ),
    );
    expect(picked.accepted.map((f) => f.name)).toEqual([
      'IMG_1.jpg',
      'IMG_2.jpg',
      'IMG_10.jpg',
      'IMG_100.jpg',
    ]);
  });

  it('conoce el nombre de la carpeta elegida (y ninguno en una selección múltiple)', () => {
    expect(pickedFolderName([file('a.jpg', 1, 'Boda Luis/a.jpg')])).toBe(
      'Boda Luis',
    );
    expect(pickedFolderName([file('a.jpg')])).toBeNull();
  });
});

describe('agregar fotos a un formato', () => {
  it('no repite una foto del mismo formato pero sí en otro formato', () => {
    const photos = [file('A.jpg'), file('B.jpg')];
    const first = planAdditions([], 'brillo', photos, { newId });
    expect(first.entries).toHaveLength(2);
    // Volver a elegir la misma carpeta no duplica nada.
    const again = planAdditions(first.entries, 'brillo', photos, { newId });
    expect(again).toMatchObject({ entries: [], duplicates: 2, overflow: 0 });
    // La misma foto en otro tamaño/papel se imprime aparte.
    const other = planAdditions(first.entries, 'mate', photos, { newId });
    expect(other.entries).toHaveLength(2);
    expect(other.entries.every((e) => e.serviceId === 'mate')).toBe(true);
  });

  it('distingue fotos con el mismo nombre en subcarpetas o con otra fecha', () => {
    const a = file('IMG_1.jpg', 10, 'Dia1/IMG_1.jpg');
    const b = file('IMG_1.jpg', 10, 'Dia2/IMG_1.jpg');
    const c = file('IMG_1.jpg', 10, 'Dia1/IMG_1.jpg', 2);
    expect(new Set([a, b, c].map(fileKey)).size).toBe(3);
    expect(planAdditions([], 'x', [a, b, c], { newId }).entries).toHaveLength(
      3,
    );
  });

  it('respeta el máximo de fotos por pedido y dice cuántas quedaron afuera', () => {
    const many = Array.from({ length: 12 }, (_, i) => file(`F${i}.jpg`));
    const result = planAdditions([], 'x', many, {
      total: PRO_MAX_FILES_PER_ORDER - 5,
      newId,
    });
    expect(result.entries).toHaveLength(5);
    expect(result.overflow).toBe(7);
  });

  it('acepta 500 fotos de una exportación sin perder ninguna', () => {
    const shoot = Array.from({ length: 500 }, (_, i) => file(`IMG_${i}.jpg`));
    const picked = classifyPickedFiles(shoot);
    const added = planAdditions([], 'brillo', picked.accepted, { newId });
    expect(added.entries).toHaveLength(500);
    expect(new Set(added.entries.map((e) => e.id)).size).toBe(500);
  });

  it('describe en una frase lo que pasó', () => {
    const picked = classifyPickedFiles([
      file('A.jpg', 1, 'Boda/A.jpg'),
      file('B.jpg', 1, 'Boda/B.jpg'),
      file('Boda.lrcat', 1, 'Boda/Boda.lrcat'),
    ]);
    const added = planAdditions(
      [{ id: 'old', serviceId: 'x', file: picked.accepted[0]!, copies: 1 }],
      'x',
      picked.accepted,
      { newId },
    );
    expect(describePick('Boda', picked, added)).toBe(
      'Carpeta «Boda»: 1 foto agregada. 1 ya estaba en este formato. 1 archivo que no es una foto se ignoró.',
    );
  });
});

describe('copias para todas', () => {
  const entries: PhotoEntry[] = [
    { id: '1', serviceId: 'brillo', file: file('a.jpg'), copies: 1 },
    { id: '2', serviceId: 'brillo', file: file('b.jpg'), copies: 4 },
    { id: '3', serviceId: 'mate', file: file('c.jpg'), copies: 3 },
  ];
  it('aplica a todas las fotos de ese formato y a ningún otro', () => {
    const next = applyCopiesToAll(entries, 'brillo', 2);
    expect(next.map((e) => e.copies)).toEqual([2, 2, 3]);
    // No muta el estado anterior.
    expect(entries.map((e) => e.copies)).toEqual([1, 4, 3]);
  });
  it('queda dentro de los límites y se puede corregir foto por foto después', () => {
    expect(applyCopiesToAll(entries, 'brillo', 0).map((e) => e.copies)).toEqual(
      [1, 1, 3],
    );
    expect(
      applyCopiesToAll(entries, 'brillo', 5000).map((e) => e.copies),
    ).toEqual([99, 99, 3]);
    const all = applyCopiesToAll(entries, 'brillo', 2);
    const single = all.map((e) => (e.id === '2' ? { ...e, copies: 7 } : e));
    expect(single.map((e) => e.copies)).toEqual([2, 7, 3]);
  });
});

describe('progreso de cientos de fotos', () => {
  it('cuenta cada estado y pondera las subidas en curso', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` }));
    const progress = new Map<
      string,
      { status: 'waiting' | 'uploading' | 'done' | 'failed'; percent: number }
    >([
      ['p0', { status: 'done', percent: 100 }],
      ['p1', { status: 'done', percent: 100 }],
      ['p2', { status: 'failed', percent: 0 }],
      ['p3', { status: 'uploading', percent: 50 }],
      ['p4', { status: 'uploading', percent: 50 }],
    ]);
    expect(summarizeProgress(entries, progress)).toEqual({
      total: 10,
      done: 2,
      failed: 1,
      uploading: 2,
      waiting: 5,
      percent: 30,
    });
    expect(summarizeProgress([], new Map()).percent).toBe(0);
  });
});

describe('lista virtualizada', () => {
  it('500 fotos son unas pocas filas en pantalla', () => {
    const top = visibleRows(0, 420, 60, 500);
    expect(top).toEqual({ start: 0, end: 11 });
    const middle = visibleRows(6000, 420, 60, 500);
    expect(middle.end - middle.start).toBeLessThanOrEqual(16);
    expect(middle.start).toBeLessThanOrEqual(100);
    expect(middle.end).toBeGreaterThanOrEqual(107);
    const bottom = visibleRows(1_000_000, 420, 60, 500);
    expect(bottom.end).toBe(500);
  });
  it('listas vacías o desplazamientos negativos no rompen nada', () => {
    expect(visibleRows(0, 420, 60, 0)).toEqual({ start: 0, end: 0 });
    expect(visibleRows(-50, 420, 60, 3)).toEqual({ start: 0, end: 3 });
  });
});

describe('pedido', () => {
  const service = (over: Partial<CatalogService> = {}): CatalogService => ({
    id: 'svc',
    name: '10x15 · Brillo',
    description: null,
    widthMm: 100,
    heightMm: 150,
    unitPriceCents: 30000,
    variantId: '00000000-0000-4000-8000-000000000001',
    ...over,
  });
  const line = (over: Partial<OrderLine> = {}): OrderLine => ({
    service: service(),
    files: 2,
    copies: 5,
    unitPriceCents: 30000,
    totalCents: 150000,
    pricingAvailable: true,
    ...over,
  });

  it('el cuerpo del pedido lleva formato, papel y cantidad: nunca lista, cliente ni precios', () => {
    const body = startProfessionalBody('key', ' 342 555 1234 ', '  ', [line()]);
    expect(body).toEqual({
      clientKey: 'key',
      phone: '342 555 1234',
      notes: undefined,
      items: [
        {
          serviceId: 'svc',
          variantId: '00000000-0000-4000-8000-000000000001',
          quantity: 5,
        },
      ],
      expectedTotalCents: 150000,
    });
    expect(JSON.stringify(body)).not.toMatch(/priceList|customer|unitPrice/);
  });

  it('dice qué falta antes de enviar', () => {
    expect(missingForProfessionalConfirm([], [], '')).toEqual([
      'elegí al menos un formato',
      'tu WhatsApp',
    ]);
    expect(
      missingForProfessionalConfirm(
        [line({ files: 0, copies: 0 })],
        ['svc'],
        '342 555 1234',
      ),
    ).toEqual(['agregá fotos de 10x15 · Brillo']);
    expect(
      missingForProfessionalConfirm(
        [line({ pricingAvailable: false })],
        ['svc'],
        '342 555 1234',
      ),
    ).toEqual(['no hay precio para 5 copias de 10x15 · Brillo']);
    expect(
      missingForProfessionalConfirm([line()], ['svc'], '342 555 1234'),
    ).toEqual([]);
  });
});

describe('acceso', () => {
  it('lee los tokens de una invitación o de un restablecimiento', () => {
    expect(
      parseAuthHash(
        '#access_token=AAA&refresh_token=BBB&expires_in=3600&type=invite',
      ),
    ).toEqual({
      type: 'invite',
      accessToken: 'AAA',
      refreshToken: 'BBB',
      error: null,
    });
    expect(
      parseAuthHash('#error=access_denied&error_description=Link+expired'),
    ).toMatchObject({
      accessToken: null,
      error: 'Link expired',
    });
    expect(parseAuthHash('')).toBeNull();
    expect(parseAuthHash('#seccion')).toBeNull();
  });
  it('exige una contraseña razonable y repetida', () => {
    expect(passwordProblem('corta', 'corta')).toMatch(/al menos 8/);
    expect(passwordProblem('suficiente1', 'otra-cosa')).toMatch(/no coinciden/);
    expect(passwordProblem('suficiente1', 'suficiente1')).toBeNull();
  });
});
