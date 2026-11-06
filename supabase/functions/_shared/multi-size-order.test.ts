/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows and JSON bodies are untyped in tests. */
// Pedidos de /imprimir con VARIOS tamaños: del carrito a las carpetas reales de Drive.
// Handlers reales → stores reales → migraciones reales (PGlite) → Drive emulado con latencia.
import { beforeEach, describe, expect, it } from 'vitest';
import { handlePublicOrderSubmit } from './public-order-handlers';
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

/** Path of a Drive item from the order's folder, e.g. `Para imprimir/10x15/IMG_1.jpg`. */
function relativePath(id: string): string {
  const files = byId();
  const names: string[] = [];
  for (let node = files.get(id); node; node = files.get(node.parents[0]!))
    names.unshift(node.name);
  return names.join('/').replace(/^.*?CC-[0-9A-F]{8} - [^/]+\//, '');
}

/** What a person opening the order in Drive sees: every live (not trashed) photo and where it is. */
function visibleDrive() {
  const live = w.google.files.filter((f) => !f.trashed);
  const photos = live
    .filter((f) => f.mimeType !== FOLDER && f.name !== 'PEDIDO.txt')
    .map((f) => relativePath(f.id).replace(/\/[0-9a-f]{8}-/, '/'))
    .sort();
  const folders = live
    .filter((f) => f.mimeType === FOLDER)
    .map((f) => relativePath(f.id))
    // Sólo lo que hay dentro de la carpeta del pedido (no los ancestros Trabajos/año/mes).
    .filter((path) => path.startsWith('Para imprimir'))
    .sort();
  return { photos, folders };
}

const submitOrder = (token: string, extra: Record<string, unknown> = {}) =>
  call(handlePublicOrderSubmit, w.orderDeps, { token, ...extra });

const rows = async (sql: string, args: unknown[] = []) =>
  (await w.db.query<any>(sql, args)).rows;

const twoSizes = (a = 2, b = 2) => [
  { serviceId: IDS.svc10x15, quantity: a },
  { serviceId: IDS.svc13x18, quantity: b },
];

describe('un solo tamaño (no se rompe)', () => {
  it('crea la carpeta del tamaño con sus fotos y confirma', async () => {
    const started = await start({
      items: [{ serviceId: IDS.svc10x15, quantity: 2 }],
    });
    const token = started.body.uploadToken as string;
    const d = dest(started, IDS.svc10x15);
    await upload(token, d, 'a.jpg');
    await upload(token, d, 'b.jpg');
    const done = await submitOrder(token, { expectedFiles: { [d]: 2 } });
    expect(done.status).toBe(200);
    expect(done.body.items).toEqual([
      { name: '10x15', quantity: 2, totalCents: 100000 },
    ]);
    expect(visibleDrive().photos).toEqual([
      'Para imprimir/10x15/a.jpg',
      'Para imprimir/10x15/b.jpg',
    ]);
  });
});

describe('varios tamaños en el mismo pedido', () => {
  it('dos tamaños con archivos distintos: una carpeta por tamaño, cada una con sus fotos', async () => {
    const started = await start({ items: twoSizes() });
    const token = started.body.uploadToken as string;
    const a = dest(started, IDS.svc10x15);
    const b = dest(started, IDS.svc13x18);
    await upload(token, a, 'foto1.jpg');
    await upload(token, a, 'foto2.jpg');
    await upload(token, b, 'foto3.jpg');
    await upload(token, b, 'foto4.jpg');
    const done = await submitOrder(token, {
      expectedFiles: { [a]: 2, [b]: 2 },
    });
    expect(done.status).toBe(200);
    expect(visibleDrive()).toEqual({
      photos: [
        'Para imprimir/10x15/foto1.jpg',
        'Para imprimir/10x15/foto2.jpg',
        'Para imprimir/13x18/foto3.jpg',
        'Para imprimir/13x18/foto4.jpg',
      ],
      folders: ['Para imprimir', 'Para imprimir/10x15', 'Para imprimir/13x18'],
    });
    // Precios y cantidades de cada tamaño, intactos.
    expect(done.body.items).toEqual([
      { name: '10x15', quantity: 2, totalCents: 100000 },
      { name: '13x18', quantity: 2, totalCents: 160000 },
    ]);
    expect(done.body.totalCents).toBe(260000);
  });

  it('la misma fotografía en dos tamaños queda asociada a ambos, sin mezclar archivos', async () => {
    const started = await start({ items: twoSizes(3, 1) });
    const token = started.body.uploadToken as string;
    const a = dest(started, IDS.svc10x15);
    const b = dest(started, IDS.svc13x18);
    await upload(token, a, 'IMG_001.jpg', 3);
    await upload(token, b, 'IMG_001.jpg', 1);
    const done = await submitOrder(token, {
      expectedFiles: { [a]: 1, [b]: 1 },
    });
    expect(done.status).toBe(200);
    expect(visibleDrive().photos).toEqual([
      'Para imprimir/10x15/IMG_001.jpg',
      'Para imprimir/13x18/IMG_001.jpg',
    ]);
    const files = await rows(
      `select i.service_name_snapshot name, f.original_filename file, f.copies, f.status
       from public.photo_job_files f join public.photo_job_items i on i.id=f.photo_job_item_id
       order by i.created_at`,
    );
    expect(files).toEqual([
      { name: '10x15', file: 'IMG_001.jpg', copies: 3, status: 'uploaded' },
      { name: '13x18', file: 'IMG_001.jpg', copies: 1, status: 'uploaded' },
    ]);
    expect(done.body.items).toEqual([
      { name: '10x15', quantity: 3, totalCents: 150000 },
      { name: '13x18', quantity: 1, totalCents: 80000 },
    ]);
  });

  it('PEDIDO.txt lista cada tamaño con sus propias fotos', async () => {
    const started = await start({ items: twoSizes(2, 2) });
    const token = started.body.uploadToken as string;
    const a = dest(started, IDS.svc10x15);
    const b = dest(started, IDS.svc13x18);
    await upload(token, a, 'a1.jpg');
    await upload(token, a, 'a2.jpg');
    await upload(token, b, 'b1.jpg');
    await upload(token, b, 'b2.jpg');
    await submitOrder(token, { expectedFiles: { [a]: 2, [b]: 2 } });
    const manifest = w.google.files.find((x) => x.name === 'PEDIDO.txt') as any;
    const text = manifest.text as string;
    expect(text.indexOf('10x15')).toBeLessThan(text.indexOf('a1.jpg'));
    expect(text.indexOf('a2.jpg')).toBeLessThan(text.indexOf('13x18'));
    expect(text.indexOf('13x18')).toBeLessThan(text.indexOf('b1.jpg'));
    expect(text).toContain('b2.jpg');
  });
});

describe('subidas en paralelo (como las manda el navegador) con un Drive lento', () => {
  it('varias fotos por tamaño a la vez: un solo árbol de carpetas y cada foto en su tamaño', async () => {
    w.google.state.latencyMs = 5;
    const started = await start({ items: twoSizes(4, 4) });
    const token = started.body.uploadToken as string;
    const a = dest(started, IDS.svc10x15);
    const b = dest(started, IDS.svc13x18);
    await Promise.all([
      upload(token, a, 'a1.jpg'),
      upload(token, b, 'b1.jpg'),
      upload(token, a, 'a2.jpg'),
      upload(token, b, 'b2.jpg'),
      upload(token, a, 'a3.jpg'),
      upload(token, b, 'b3.jpg'),
      upload(token, a, 'a4.jpg'),
      upload(token, b, 'b4.jpg'),
    ]);
    const done = await submitOrder(token, {
      expectedFiles: { [a]: 4, [b]: 4 },
    });
    expect(done.status).toBe(200);
    const { photos, folders } = visibleDrive();
    expect(photos).toEqual([
      'Para imprimir/10x15/a1.jpg',
      'Para imprimir/10x15/a2.jpg',
      'Para imprimir/10x15/a3.jpg',
      'Para imprimir/10x15/a4.jpg',
      'Para imprimir/13x18/b1.jpg',
      'Para imprimir/13x18/b2.jpg',
      'Para imprimir/13x18/b3.jpg',
      'Para imprimir/13x18/b4.jpg',
    ]);
    // Sin carpetas duplicadas visibles; las sobrantes quedaron en la papelera, vacías.
    expect(folders).toEqual([
      'Para imprimir',
      'Para imprimir/10x15',
      'Para imprimir/13x18',
    ]);
    const live = w.google.files.filter((f) => !f.trashed);
    expect(live.filter((f) => f.name === 'Trabajos')).toHaveLength(1);
    const trashedIds = new Set(
      w.google.files.filter((f) => f.trashed).map((f) => f.id),
    );
    expect(
      w.google.files.filter(
        (f) => f.mimeType !== FOLDER && trashedIds.has(f.parents[0]!),
      ),
    ).toEqual([]);
    // PEDIDO.txt está en la carpeta del pedido que contiene ambos tamaños.
    const manifest = live.find((x) => x.name === 'PEDIDO.txt')!;
    expect(relativePath(manifest.id)).toBe('PEDIDO.txt');
  });
});

describe('fallo parcial de subida', () => {
  it('no confirma el pedido si un tamaño perdió fotos; reintentando sólo las faltantes se confirma', async () => {
    const started = await start({ items: twoSizes() });
    const token = started.body.uploadToken as string;
    const a = dest(started, IDS.svc10x15);
    const b = dest(started, IDS.svc13x18);
    await upload(token, a, 'a1.jpg');
    await upload(token, a, 'a2.jpg');
    await upload(token, b, 'b1.jpg');
    // La foto b2 falla: Drive no responde al abrir la sesión.
    w.google.state.driveFailure = { status: 503, reason: 'backendError' };
    const failed = await upload(token, b, 'b2.jpg');
    expect(failed.session.status).toBeGreaterThanOrEqual(500);
    w.google.state.driveFailure = null;

    const blocked = await submitOrder(token, {
      expectedFiles: { [a]: 2, [b]: 2 },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('order_incomplete');
    expect(blocked.body.error).toContain('13x18');
    expect(blocked.body.error).toContain('llegaron 1 de 2');
    expect(
      (await rows(`select is_draft from public.photo_jobs`))[0].is_draft,
    ).toBe(true);

    // Reintento: sólo la foto que faltaba (las demás no se vuelven a subir).
    await upload(token, b, 'b2.jpg');
    const done = await submitOrder(token, {
      expectedFiles: { [a]: 2, [b]: 2 },
    });
    expect(done.status).toBe(200);
    expect(done.body.totalCents).toBe(260000);
    expect(visibleDrive().photos).toEqual([
      'Para imprimir/10x15/a1.jpg',
      'Para imprimir/10x15/a2.jpg',
      'Para imprimir/13x18/b1.jpg',
      'Para imprimir/13x18/b2.jpg',
    ]);
  });

  it('un tamaño sin ninguna foto tampoco se confirma como completo (ni con un navegador sin recuentos)', async () => {
    const started = await start({ items: twoSizes() });
    const token = started.body.uploadToken as string;
    const a = dest(started, IDS.svc10x15);
    await upload(token, a, 'a1.jpg');
    await upload(token, a, 'a2.jpg');
    const legacy = await submitOrder(token);
    expect(legacy.status).toBe(409);
    expect(legacy.body.code).toBe('order_incomplete');
    expect(legacy.body.error).toContain('13x18');
    expect(
      (await rows(`select is_draft from public.photo_jobs`))[0].is_draft,
    ).toBe(true);
  });

  it('si el cliente decide enviar sin esas fotos, se confirma sólo lo que llegó y el total lo refleja', async () => {
    const started = await start({ items: twoSizes() });
    const token = started.body.uploadToken as string;
    const a = dest(started, IDS.svc10x15);
    const b = dest(started, IDS.svc13x18);
    await upload(token, a, 'a1.jpg');
    await upload(token, a, 'a2.jpg');
    const done = await submitOrder(token, {
      expectedFiles: { [a]: 2, [b]: 0 },
      acceptPartial: true,
    });
    expect(done.status).toBe(200);
    expect(done.body.items).toEqual([
      { name: '10x15', quantity: 2, totalCents: 100000 },
    ]);
    expect(done.body.totalCents).toBe(100000);
  });

  it('rechaza recuentos o banderas mal formados', async () => {
    const started = await start({ items: twoSizes() });
    const token = started.body.uploadToken as string;
    expect(
      (await submitOrder(token, { expectedFiles: { x: -1 } })).body.code,
    ).toBe('invalid_request');
    expect((await submitOrder(token, { acceptPartial: 'yes' })).body.code).toBe(
      'invalid_request',
    );
  });
});

describe('reintentos sin duplicar fotos', () => {
  const session = (token: string, d: string, name: string, previous?: string) =>
    call(handleUploadSession, w.uploadDeps, {
      token,
      destinationId: d,
      filename: name,
      mimeType: 'image/jpeg',
      sizeBytes: 12,
      copies: 1,
      previousUploadId: previous,
    });
  const putBytes = async (uploadId: string) => {
    const row = (
      await rows(
        `select drive_file_id from public.photo_job_files where id=$1`,
        [uploadId],
      )
    )[0];
    (w.google.files.find((x) => x.id === row.drive_file_id) as any).text =
      'x'.repeat(12);
  };

  it('si la subida llegó pero el navegador perdió la respuesta, el reintento no la guarda dos veces', async () => {
    const started = await start({ items: twoSizes(1, 1) });
    const token = started.body.uploadToken as string;
    const b = dest(started, IDS.svc13x18);
    const first = await session(token, b, 'b1.jpg');
    await putBytes(first.body.uploadId);
    const finalized = await call(handleUploadFinalize, w.uploadDeps, {
      token,
      uploadId: first.body.uploadId,
    });
    expect(finalized.status).toBe(200); // …pero el navegador no vio esta respuesta.

    const retry = await session(token, b, 'b1.jpg', first.body.uploadId);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({
      uploadId: first.body.uploadId,
      alreadyUploaded: true,
    });
    expect(await rows(`select status from public.photo_job_files`)).toEqual([
      { status: 'uploaded' },
    ]);
    expect(visibleDrive().photos).toEqual(['Para imprimir/13x18/b1.jpg']);
  });

  it('si la subida quedó a medias, el reintento reemplaza el intento y deja una sola copia en Drive', async () => {
    const started = await start({ items: twoSizes(1, 1) });
    const token = started.body.uploadToken as string;
    const b = dest(started, IDS.svc13x18);
    const first = await session(token, b, 'b1.jpg');
    await putBytes(first.body.uploadId); // llegaron los bytes, nunca se finalizó

    const retry = await session(token, b, 'b1.jpg', first.body.uploadId);
    expect(retry.body.alreadyUploaded).toBeUndefined();
    expect(retry.body.uploadId).not.toBe(first.body.uploadId);
    await putBytes(retry.body.uploadId);
    await call(handleUploadFinalize, w.uploadDeps, {
      token,
      uploadId: retry.body.uploadId,
    });

    expect(
      await rows(
        `select status, count(*)::int n from public.photo_job_files group by status order by status`,
      ),
    ).toEqual([
      { status: 'failed', n: 1 },
      { status: 'uploaded', n: 1 },
    ]);
    expect(visibleDrive().photos).toEqual(['Para imprimir/13x18/b1.jpg']);
  });

  it('un reintento que nombra el intento de OTRO tamaño no lo toca ni lo cuenta', async () => {
    const started = await start({ items: twoSizes(1, 1) });
    const token = started.body.uploadToken as string;
    const a = dest(started, IDS.svc10x15);
    const b = dest(started, IDS.svc13x18);
    const other = await upload(token, a, 'a1.jpg');
    const retry = await session(
      token,
      b,
      'b1.jpg',
      other.session.body.uploadId,
    );
    expect(retry.status).toBe(200);
    expect(retry.body.alreadyUploaded).toBeUndefined();
    expect(
      await rows(`select status from public.photo_job_files where id=$1`, [
        other.session.body.uploadId,
      ]),
    ).toEqual([{ status: 'uploaded' }]);
  });
});

describe('relación entre archivos, tamaños y pedido', () => {
  it('cada archivo pertenece al tamaño y al pedido correctos y apunta a la carpeta de ese tamaño', async () => {
    const started = await start({ items: twoSizes(3, 2) });
    const token = started.body.uploadToken as string;
    const a = dest(started, IDS.svc10x15);
    const b = dest(started, IDS.svc13x18);
    await upload(token, a, 'a1.jpg', 2);
    await upload(token, a, 'a2.jpg', 1);
    await upload(token, b, 'b1.jpg', 2);
    await submitOrder(token, { expectedFiles: { [a]: 2, [b]: 1 } });

    const files = await rows(
      `select i.service_name_snapshot name, i.quantity, i.total_cents, f.original_filename file,
              f.copies, f.drive_folder_id, f.photo_job_id = i.photo_job_id same_job,
              (select jf.drive_folder_id from public.photo_job_drive_folders jf
                where jf.photo_job_id=i.photo_job_id and jf.folder_key='item:'||i.id) mapped
       from public.photo_job_files f join public.photo_job_items i on i.id=f.photo_job_item_id
       order by i.created_at, f.original_filename`,
    );
    expect(
      files.map((x: any) => [x.name, x.file, x.copies, x.same_job]),
    ).toEqual([
      ['10x15', 'a1.jpg', 2, true],
      ['10x15', 'a2.jpg', 1, true],
      ['13x18', 'b1.jpg', 2, true],
    ]);
    for (const row of files) expect(row.drive_folder_id).toBe(row.mapped);
    expect(
      files.map((x: any) => [x.name, x.quantity, Number(x.total_cents)]),
    ).toEqual([
      ['10x15', 3, 150000],
      ['10x15', 3, 150000],
      ['13x18', 2, 160000],
    ]);
  });
});
