/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows and JSON bodies are untyped in tests. */
// Nombre final de cada foto en Drive: `001_3copias.jpg`. Lo decide el servidor al confirmar, con
// las copias definitivas. Handlers reales → stores reales → migraciones reales (PGlite) → Drive emulado.
import { beforeEach, describe, expect, it } from 'vitest';
import { handlePublicOrderSubmit } from './public-order-handlers';
import {
  copiesLabel,
  parseSubmitPayload,
  planFinalNames,
} from './public-order-plan';
import { IDS } from './pg-harness';
import { orderFlow } from './pg-order-flow';
import { createWorld, type World } from './pg-world';
import { handleUploadFinalize, handleUploadSession } from './upload-handlers';

let w: World;
const { call, start, upload, dest } = orderFlow(() => w);

beforeEach(async () => {
  w = await createWorld();
});

const FOLDER = 'application/vnd.google-apps.folder';
const byId = () => new Map(w.google.files.map((f) => [f.id, f]));

function relativePath(id: string): string {
  const files = byId();
  const names: string[] = [];
  for (let node = files.get(id); node; node = files.get(node.parents[0]!))
    names.unshift(node.name);
  return names.join('/').replace(/^.*?CC-[0-9A-F]{8} - [^/]+\//, '');
}

/** What the laboratory sees: every live photo, as `<folder>/<name>`. */
const driveNames = () =>
  w.google.files
    .filter(
      (f) => !f.trashed && f.mimeType !== FOLDER && f.name !== 'PEDIDO.txt',
    )
    .map((f) => relativePath(f.id).replace(/^Para imprimir\//, ''))
    .sort();

const submitOrder = (token: string, extra: Record<string, unknown> = {}) =>
  call(handlePublicOrderSubmit, w.orderDeps, { token, ...extra });
const rows = async (sql: string, args: unknown[] = []) =>
  (await w.db.query<any>(sql, args)).rows;

const session = (
  token: string,
  d: string,
  name: string,
  copies: number,
  previous?: string,
) =>
  call(handleUploadSession, w.uploadDeps, {
    token,
    destinationId: d,
    filename: name,
    mimeType: 'image/jpeg',
    sizeBytes: 12,
    copies,
    previousUploadId: previous,
  });
const putBytes = async (uploadId: string) => {
  const row = (
    await rows(`select drive_file_id from public.photo_job_files where id=$1`, [
      uploadId,
    ])
  )[0];
  (w.google.files.find((x) => x.id === row.drive_file_id) as any).text =
    'x'.repeat(12);
};

describe('nombre de archivo: reglas puras', () => {
  it('numera de a uno, con tres dígitos, y singular/plural de copias', () => {
    expect(copiesLabel(1)).toBe('1copia');
    expect(copiesLabel(3)).toBe('3copias');
    const names = planFinalNames(
      [
        { id: 'b', original_filename: 'IMG_2.PNG', copies: 1, created_at: '2' },
        { id: 'a', original_filename: 'IMG_1.jpg', copies: 3, created_at: '1' },
        {
          id: 'c',
          original_filename: 'sin-extension',
          copies: 5,
          created_at: '3',
        },
      ],
      null,
    );
    expect([...names.values()]).toEqual([
      '001_3copias.jpg',
      '002_1copia.PNG',
      '003_5copias',
    ]);
  });

  it('el orden que manda el navegador manda; sin él, creación e id (determinista)', () => {
    const files = ['x', 'y', 'z'].map((id, index) => ({
      id,
      original_filename: `${id}.jpg`,
      copies: index + 1,
      created_at: '2026-11-06T00:00:00Z',
    }));
    expect(planFinalNames(files, ['z', 'x', 'y']).get('z')).toBe(
      '001_3copias.jpg',
    );
    expect(planFinalNames(files, null).get('x')).toBe('001_1copia.jpg');
    expect(planFinalNames([...files].reverse(), null)).toEqual(
      planFinalNames(files, null),
    );
  });

  it('valida la lista de uploadIds', () => {
    expect(
      parseSubmitPayload({
        uploadIds: ['A0000000-0000-4000-8000-000000000015'],
      }).uploadIds,
    ).toEqual(['a0000000-0000-4000-8000-000000000015']);
    expect(() => parseSubmitPayload({ uploadIds: ['no-es-uuid'] })).toThrow();
    expect(() => parseSubmitPayload({ uploadIds: 'x' as any })).toThrow();
  });
});

describe('el nombre refleja la cantidad real de copias', () => {
  it('001_3copias, 002_1copia y 003_5copias; conserva extensión y nombre original', async () => {
    const started = await start({
      items: [{ serviceId: IDS.svc10x15, quantity: 9 }],
    });
    const token = started.body.uploadToken as string;
    const d = dest(started, IDS.svc10x15);
    const ids: string[] = [];
    for (const [name, copies] of [
      ['IMG_20261106_153024.jpg', 3],
      ['foto con espacios.JPG', 1],
      ['retrato.heic', 5],
    ] as const)
      ids.push((await upload(token, d, name, copies)).session.body.uploadId);
    const done = await submitOrder(token, {
      expectedFiles: { [d]: 3 },
      uploadIds: ids,
    });
    expect(done.status).toBe(200);
    expect(driveNames()).toEqual([
      '10x15/001_3copias.jpg',
      '10x15/002_1copia.JPG',
      '10x15/003_5copias.heic',
    ]);
    const files = await rows(
      `select original_filename, stored_filename, copies from public.photo_job_files order by stored_filename`,
    );
    expect(files).toEqual([
      {
        original_filename: 'IMG_20261106_153024.jpg',
        stored_filename: '001_3copias.jpg',
        copies: 3,
      },
      {
        original_filename: 'foto con espacios.JPG',
        stored_filename: '002_1copia.JPG',
        copies: 1,
      },
      {
        original_filename: 'retrato.heic',
        stored_filename: '003_5copias.heic',
        copies: 5,
      },
    ]);
    // La cantidad cobrada y la de los nombres son la misma.
    expect(done.body.items).toEqual([
      { name: '10x15', quantity: 9, totalCents: 450000 },
    ]);
    const manifest = w.google.files.find((x) => x.name === 'PEDIDO.txt') as any;
    expect(manifest.text).toContain(
      '001_3copias.jpg | 3 copias | original: IMG_20261106_153024.jpg',
    );
  });

  it('si el cliente cambia la cantidad antes de confirmar, el nombre guarda la cantidad final', async () => {
    const started = await start({
      items: [{ serviceId: IDS.svc10x15, quantity: 2 }],
    });
    const token = started.body.uploadToken as string;
    const d = dest(started, IDS.svc10x15);
    const first = await upload(token, d, 'a.jpg', 2);
    // Confirmar falló; el cliente vuelve, sube la cantidad de 2 a 4 y reenvía: la foto ya estaba.
    const retry = await session(
      token,
      d,
      'a.jpg',
      4,
      first.session.body.uploadId,
    );
    expect(retry.body).toEqual({
      uploadId: first.session.body.uploadId,
      alreadyUploaded: true,
    });
    const done = await submitOrder(token, {
      expectedFiles: { [d]: 1 },
      uploadIds: [first.session.body.uploadId],
    });
    expect(done.status).toBe(200);
    expect(driveNames()).toEqual(['10x15/001_4copias.jpg']);
    expect(done.body.items).toEqual([
      { name: '10x15', quantity: 4, totalCents: 200000 },
    ]);
  });

  it('un nombre que ya parece final, venga del navegador, no se respeta: manda lo guardado', async () => {
    const started = await start({
      items: [{ serviceId: IDS.svc10x15, quantity: 2 }],
    });
    const token = started.body.uploadToken as string;
    const d = dest(started, IDS.svc10x15);
    const sent = await upload(token, d, '999_100copias.jpg', 2);
    const done = await submitOrder(token, {
      uploadIds: [sent.session.body.uploadId],
      name: '777_50copias.jpg',
    });
    expect(done.status).toBe(200);
    expect(driveNames()).toEqual(['10x15/001_2copias.jpg']);
    expect(
      (await rows(`select original_filename o from public.photo_job_files`))[0]
        .o,
    ).toBe('999_100copias.jpg');
  });
});

describe('numeración por carpeta', () => {
  it('cada tamaño numera desde 001 y la misma foto en dos tamaños tiene su archivo en cada carpeta', async () => {
    const started = await start({
      items: [
        { serviceId: IDS.svc10x15, quantity: 4 },
        { serviceId: IDS.svc13x18, quantity: 3 },
      ],
    });
    const token = started.body.uploadToken as string;
    const a = dest(started, IDS.svc10x15);
    const b = dest(started, IDS.svc13x18);
    const ids = [
      (await upload(token, a, 'IMG_001.jpg', 3)).session.body.uploadId,
      (await upload(token, a, 'IMG_002.jpg', 1)).session.body.uploadId,
      (await upload(token, b, 'IMG_001.jpg', 2)).session.body.uploadId,
      (await upload(token, b, 'IMG_003.jpg', 1)).session.body.uploadId,
    ];
    const done = await submitOrder(token, {
      expectedFiles: { [a]: 2, [b]: 2 },
      uploadIds: ids,
    });
    expect(done.status).toBe(200);
    expect(driveNames()).toEqual([
      '10x15/001_3copias.jpg',
      '10x15/002_1copia.jpg',
      '13x18/001_2copias.jpg',
      '13x18/002_1copia.jpg',
    ]);
    expect(done.body.totalCents).toBe(4 * 50000 + 3 * 80000);
  });

  it('el mismo tamaño en Brillo y en Mate: dos carpetas, cada una con su propia numeración', async () => {
    const lists = (
      await rows(
        `select id from public.price_lists where is_default and is_active`,
      )
    )[0].id;
    const glossy = (
      await rows(
        `select id from public.lab_variants where photo_service_id=$1 and paper='glossy'`,
        [IDS.svc10x15],
      )
    )[0].id;
    const matte = (
      await rows(
        `insert into public.lab_variants(business_id,photo_service_id,channel,paper)
         values($1,$2,'laboratory','matte') returning id`,
        [IDS.business, IDS.svc10x15],
      )
    )[0].id;
    await w.db.query(
      `insert into public.lab_price_tiers(business_id,variant_id,price_list_id,min_quantity,unit_price_cents)
       values($1,$2,$3,1,55000)`,
      [IDS.business, matte, lists],
    );
    const started = await start({
      items: [
        { serviceId: IDS.svc10x15, variantId: glossy, quantity: 2 },
        { serviceId: matte, variantId: matte, quantity: 3 },
      ],
    });
    expect(started.status).toBe(200);
    const token = started.body.uploadToken as string;
    const g = dest(started, IDS.svc10x15);
    const m = dest(started, matte);
    const ids = [
      (await upload(token, g, 'a.jpg', 2)).session.body.uploadId,
      (await upload(token, m, 'a.jpg', 1)).session.body.uploadId,
      (await upload(token, m, 'b.jpg', 2)).session.body.uploadId,
    ];
    const done = await submitOrder(token, {
      expectedFiles: { [g]: 1, [m]: 2 },
      uploadIds: ids,
    });
    expect(done.status).toBe(200);
    expect(driveNames()).toEqual([
      '10x15 · Brillo · Publico/001_2copias.jpg',
      '10x15 · Mate · Publico/001_1copia.jpg',
      '10x15 · Mate · Publico/002_2copias.jpg',
    ]);
    expect(done.body.totalCents).toBe(2 * 50000 + 3 * 55000);
  });

  it('subidas simultáneas con un Drive lento: nombres únicos y consecutivos, en el orden del cliente', async () => {
    w.google.state.latencyMs = 5;
    const started = await start({
      items: [{ serviceId: IDS.svc10x15, quantity: 6 }],
    });
    const token = started.body.uploadToken as string;
    const d = dest(started, IDS.svc10x15);
    const names = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'];
    const results = await Promise.all(
      names.map((n, i) => upload(token, d, `${n}.jpg`, i + 1)),
    );
    const ids = results.map((r) => r.session.body.uploadId as string);
    const done = await submitOrder(token, {
      expectedFiles: { [d]: 6 },
      uploadIds: ids,
    });
    expect(done.status).toBe(200);
    expect(driveNames()).toEqual([
      '10x15/001_1copia.jpg',
      '10x15/002_2copias.jpg',
      '10x15/003_3copias.jpg',
      '10x15/004_4copias.jpg',
      '10x15/005_5copias.jpg',
      '10x15/006_6copias.jpg',
    ]);
    // La foto n-ésima del cliente es la n-ésima del laboratorio, aunque hayan llegado desordenadas.
    const stored = await rows(
      `select original_filename o, stored_filename s from public.photo_job_files order by stored_filename`,
    );
    expect(stored.map((x: any) => x.o)).toEqual(names.map((n) => `${n}.jpg`));
  });
});

describe('fotos que el cliente quitó o movió después de subirlas', () => {
  it('una foto subida y luego eliminada no se imprime, no se cobra y va a la papelera de Drive', async () => {
    const started = await start({
      items: [{ serviceId: IDS.svc10x15, quantity: 3 }],
    });
    const token = started.body.uploadToken as string;
    const d = dest(started, IDS.svc10x15);
    const keep = await upload(token, d, 'queda.jpg', 1);
    const gone = await upload(token, d, 'quitada.jpg', 2);
    const done = await submitOrder(token, {
      expectedFiles: { [d]: 1 },
      uploadIds: [keep.session.body.uploadId],
    });
    expect(done.status).toBe(200);
    expect(driveNames()).toEqual(['10x15/001_1copia.jpg']);
    expect(done.body.items).toEqual([
      { name: '10x15', quantity: 1, totalCents: 50000 },
    ]);
    expect(
      await rows(`select status from public.photo_job_files where id=$1`, [
        gone.session.body.uploadId,
      ]),
    ).toEqual([{ status: 'removed' }]);
  });

  it('cambiar el tamaño de un bloque con fotos ya subidas: el pedido sólo tiene el tamaño nuevo', async () => {
    const first = await start({
      items: [{ serviceId: IDS.svc10x15, quantity: 2 }],
    });
    const token1 = first.body.uploadToken as string;
    const oldDest = dest(first, IDS.svc10x15);
    await upload(token1, oldDest, 'a.jpg', 2);
    // El cliente vuelve atrás y pasa ese bloque de 10x15 a 13x18; reenvía la misma foto.
    const second = await start({
      items: [{ serviceId: IDS.svc13x18, quantity: 2 }],
    });
    const token2 = second.body.uploadToken as string;
    const newDest = dest(second, IDS.svc13x18);
    const moved = await upload(token2, newDest, 'a.jpg', 2);
    const done = await submitOrder(token2, {
      expectedFiles: { [newDest]: 1 },
      uploadIds: [moved.session.body.uploadId],
    });
    expect(done.status).toBe(200);
    expect(driveNames()).toEqual(['13x18/001_2copias.jpg']);
    expect(done.body.items).toEqual([
      { name: '13x18', quantity: 2, totalCents: 160000 },
    ]);
  });
});

describe('fallos y reintentos de la confirmación', () => {
  it('si Drive falla al renombrar, no se confirma; reintentar converge sin duplicar ni perder fotos', async () => {
    const started = await start({
      items: [{ serviceId: IDS.svc10x15, quantity: 3 }],
    });
    const token = started.body.uploadToken as string;
    const d = dest(started, IDS.svc10x15);
    const ids = [
      (await upload(token, d, 'a.jpg', 2)).session.body.uploadId,
      (await upload(token, d, 'b.jpg', 1)).session.body.uploadId,
    ];
    w.google.state.driveFailure = { status: 503, reason: 'backendError' };
    const failed = await submitOrder(token, {
      expectedFiles: { [d]: 2 },
      uploadIds: ids,
    });
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(
      (await rows(`select is_draft from public.photo_jobs`))[0].is_draft,
    ).toBe(true);
    w.google.state.driveFailure = null;

    const done = await submitOrder(token, {
      expectedFiles: { [d]: 2 },
      uploadIds: ids,
    });
    expect(done.status).toBe(200);
    expect(driveNames()).toEqual([
      '10x15/001_2copias.jpg',
      '10x15/002_1copia.jpg',
    ]);
    expect(
      (await rows(`select count(*)::int n from public.photo_job_files`))[0].n,
    ).toBe(2);
  });

  it('confirmar dos veces el mismo pedido no vuelve a renombrar ni cambia nada', async () => {
    const started = await start({
      items: [{ serviceId: IDS.svc10x15, quantity: 2 }],
    });
    const token = started.body.uploadToken as string;
    const d = dest(started, IDS.svc10x15);
    const sent = await upload(token, d, 'a.jpg', 2);
    const body = {
      expectedFiles: { [d]: 1 },
      uploadIds: [sent.session.body.uploadId],
    };
    await submitOrder(token, body);
    const before = driveNames();
    const renames = w.google.requests.filter(
      (r) => r.method === 'PATCH' && /name/.test(r.body ?? ''),
    ).length;
    const again = await submitOrder(token, body);
    expect(again.status).toBe(200);
    expect(again.body.alreadySubmitted).toBe(true);
    expect(driveNames()).toEqual(before);
    expect(
      w.google.requests.filter(
        (r) => r.method === 'PATCH' && /name/.test(r.body ?? ''),
      ).length,
    ).toBe(renames);
  });

  it('un pedido incompleto sigue sin confirmarse y no renombra nada', async () => {
    const started = await start({
      items: [
        { serviceId: IDS.svc10x15, quantity: 2 },
        { serviceId: IDS.svc13x18, quantity: 2 },
      ],
    });
    const token = started.body.uploadToken as string;
    const a = dest(started, IDS.svc10x15);
    const b = dest(started, IDS.svc13x18);
    const sent = await upload(token, a, 'a.jpg', 2);
    const blocked = await submitOrder(token, {
      expectedFiles: { [a]: 1, [b]: 1 },
      uploadIds: [sent.session.body.uploadId],
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('order_incomplete');
    expect(driveNames()).toHaveLength(1);
    expect(
      (await rows(`select stored_filename s from public.photo_job_files`))[0].s,
    ).toMatch(/^[0-9a-f]{8}-a\.jpg$/);
  });

  it('un reintento que ya llegó a Drive sigue siendo una sola foto con su copia final', async () => {
    const started = await start({
      items: [{ serviceId: IDS.svc10x15, quantity: 2 }],
    });
    const token = started.body.uploadToken as string;
    const d = dest(started, IDS.svc10x15);
    const first = await session(token, d, 'a.jpg', 2);
    await putBytes(first.body.uploadId);
    await call(handleUploadFinalize, w.uploadDeps, {
      token,
      uploadId: first.body.uploadId,
    });
    const retry = await session(token, d, 'a.jpg', 2, first.body.uploadId);
    expect(retry.body.alreadyUploaded).toBe(true);
    const done = await submitOrder(token, {
      expectedFiles: { [d]: 1 },
      uploadIds: [retry.body.uploadId],
    });
    expect(done.status).toBe(200);
    expect(driveNames()).toEqual(['10x15/001_2copias.jpg']);
  });
});
