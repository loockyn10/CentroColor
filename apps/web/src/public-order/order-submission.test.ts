import { describe, expect, it } from 'vitest';
import { uploadPhoto, type UploadDeps } from './client';
import type { PhotoEntry } from './model';
import {
  buildSubmitOptions,
  errorCode,
  isIncompleteOrder,
  sendEntries,
  type UploadProgress,
} from './order-submission';

const entry = (id: string, serviceId: string, copies = 1): PhotoEntry => ({
  id,
  serviceId,
  file: new File(['x'], `${id}.jpg`),
  copies,
});
const started = {
  uploadToken: 'token',
  destinations: [
    { serviceId: 'a', destinationId: 'dest-a' },
    { serviceId: 'b', destinationId: 'dest-b' },
  ],
};

describe('envío de fotos (compartido por /imprimir y /profesionales)', () => {
  it('nunca supera la concurrencia pedida y recuerda el último intento de cada foto', async () => {
    const entries = Array.from({ length: 40 }, (_, i) => entry(`p${i}`, 'a'));
    let inFlight = 0;
    let peak = 0;
    const upload = (async (
      _token: string,
      target: { id: string },
      _progress: unknown,
      options: { onAttempt?: (id: string) => void },
    ) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      options.onAttempt?.(`up-${target.id}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    }) as unknown as typeof uploadPhoto;
    const attempts = new Map<string, string>();
    const progress = new Map<string, UploadProgress>();
    const failed = await sendEntries({
      started,
      entries,
      attempts,
      concurrency: 4,
      onProgress: (id, value) => progress.set(id, value),
      upload,
    });
    expect(failed).toBe(0);
    expect(peak).toBe(4);
    expect(attempts.size).toBe(40);
    expect([...progress.values()].every((p) => p.status === 'done')).toBe(true);
  });

  it('no rechaza: cuenta las fallidas, marca su error y el reintento nombra el intento previo', async () => {
    const entries = [entry('p1', 'a'), entry('p2', 'a'), entry('p3', 'b')];
    const seen: Array<{ id: string; previous?: string }> = [];
    let broken = true;
    const upload = (async (
      _token: string,
      target: { id: string; previousUploadId?: string; destinationId: string },
      _progress: unknown,
      options: { onAttempt?: (id: string) => void },
    ) => {
      seen.push({ id: target.id, previous: target.previousUploadId });
      options.onAttempt?.(`up-${target.id}-${seen.length}`);
      if (target.id === 'p2' && broken)
        throw new Error('Se cortó la conexión.');
      expect(target.destinationId).toBe(
        target.id === 'p3' ? 'dest-b' : 'dest-a',
      );
    }) as unknown as typeof uploadPhoto;
    const attempts = new Map<string, string>();
    const progress = new Map<string, UploadProgress>();
    const onProgress = (id: string, value: UploadProgress) =>
      progress.set(id, value);

    expect(
      await sendEntries({
        started,
        entries,
        attempts,
        concurrency: 2,
        onProgress,
        upload,
      }),
    ).toBe(1);
    expect(progress.get('p2')).toMatchObject({
      status: 'failed',
      error: 'Se cortó la conexión.',
    });

    broken = false;
    seen.length = 0;
    const retry = entries.filter(
      (e) => progress.get(e.id)?.status === 'failed',
    );
    expect(
      await sendEntries({
        started,
        entries: retry,
        attempts,
        concurrency: 2,
        onProgress,
        upload,
      }),
    ).toBe(0);
    // Sólo viajó la fallida, y dijo cuál había sido su intento anterior.
    expect(seen).toEqual([
      { id: 'p2', previous: attempts.get('p2') && seen[0]!.previous },
    ]);
    expect(seen[0]!.previous).toMatch(/^up-p2-/);
  });

  it('uploadPhoto espera y reintenta cuando el servidor pide ir más despacio', async () => {
    const pauses: number[] = [];
    let calls = 0;
    const deps: UploadDeps = {
      call: (async (name: string) => {
        if (name === 'photo-upload-session') {
          calls += 1;
          if (calls < 3)
            throw Object.assign(new Error('Hay demasiadas cargas.'), {
              code: 'rate_limited',
            });
          return { uploadId: 'u', uploadUrl: 'https://drive/u', chunkSize: 10 };
        }
        return {};
      }) as UploadDeps['call'],
      uploadChunks: (async () => undefined) as UploadDeps['uploadChunks'],
    };
    await uploadPhoto(
      'token',
      {
        id: 'p',
        file: new File(['x'], 'p.jpg'),
        copies: 1,
        destinationId: 'd',
      },
      () => undefined,
      { deps, sleep: async (ms) => void pauses.push(ms) },
    );
    expect(calls).toBe(3);
    expect(pauses).toEqual([5000, 10000]);
  });
});

describe('confirmación', () => {
  const sent = [entry('p1', 'a'), entry('p2', 'b'), entry('p3', 'a')];
  const attempts = new Map([
    ['p1', 'u1'],
    ['p2', 'u2'],
    ['p3', 'u3'],
  ]);

  it('declara cuántas fotos mandó a cada destino y el orden en que se ven', () => {
    expect(
      buildSubmitOptions({ started, selected: ['a', 'b'], sent, attempts }),
    ).toEqual({
      expectedFiles: { 'dest-a': 2, 'dest-b': 1 },
      uploadIds: ['u1', 'u3', 'u2'],
    });
    // Si el orden de los bloques cambia, cambia la numeración de archivos.
    expect(
      buildSubmitOptions({ started, selected: ['b', 'a'], sent, attempts })
        .uploadIds,
    ).toEqual(['u2', 'u1', 'u3']);
  });

  it('sin intento registrado para alguna foto no manda uploadIds (el servidor no retira nada)', () => {
    const options = buildSubmitOptions({
      started,
      selected: ['a', 'b'],
      sent,
      attempts: new Map([['p1', 'u1']]),
    });
    expect(options.uploadIds).toBeUndefined();
    expect(options.expectedFiles).toEqual({ 'dest-a': 2, 'dest-b': 1 });
  });

  it('«enviar sin esas fotos» es explícito', () => {
    expect(
      buildSubmitOptions({
        started,
        selected: ['a', 'b'],
        sent,
        attempts,
        acceptPartial: true,
      }).acceptPartial,
    ).toBe(true);
    expect(
      buildSubmitOptions({ started, selected: ['a', 'b'], sent, attempts })
        .acceptPartial,
    ).toBeUndefined();
  });

  it('reconoce un pedido incompleto por el código del servidor', () => {
    expect(
      isIncompleteOrder(
        Object.assign(new Error('x'), { code: 'order_incomplete' }),
      ),
    ).toBe(true);
    expect(isIncompleteOrder(new Error('x'))).toBe(false);
    expect(errorCode(null)).toBeNull();
  });
});
