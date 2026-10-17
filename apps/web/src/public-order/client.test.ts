import { describe, expect, it, vi } from 'vitest';
import {
  PublicOrderError,
  runPool,
  uploadPhoto,
  type UploadDeps,
  type UploadTarget,
} from './client';

const target: UploadTarget = {
  id: 'a',
  file: new Blob(['12345678'], { type: 'image/jpeg' }) as File,
  copies: 2,
  destinationId: 'dest-1',
};
Object.defineProperty(target.file, 'name', { value: 'IMG_001.jpg' });

const session = (n: number) => ({
  uploadId: `upload-${n}`,
  uploadUrl: `https://upload.example/${n}`,
  chunkSize: 4,
});

describe('subida de una foto', () => {
  it('abre la sesión, sube los bytes y confirma, informando progreso', async () => {
    const calls: string[] = [];
    const deps: UploadDeps = {
      call: vi.fn(async (name: string, body: unknown) => {
        calls.push(name);
        if (name === 'photo-upload-session') {
          expect(body).toMatchObject({
            token: 'tok',
            destinationId: 'dest-1',
            filename: 'IMG_001.jpg',
            copies: 2,
            sizeBytes: 8,
          });
          return session(1);
        }
        return { ok: true };
      }) as unknown as UploadDeps['call'],
      uploadChunks: vi.fn(
        async (_f, _u, _c, onProgress: (n: number) => void) => {
          onProgress(50);
        },
      ) as unknown as UploadDeps['uploadChunks'],
    };
    const progress: number[] = [];
    await uploadPhoto('tok', target, (n) => progress.push(n), { deps });
    expect(calls).toEqual(['photo-upload-session', 'photo-upload-finalize']);
    expect(progress).toEqual([0, 50, 100]);
  });

  it('reintenta con una sesión nueva y le indica cuál falló', async () => {
    let sessions = 0;
    const bodies: unknown[] = [];
    const deps: UploadDeps = {
      call: vi.fn(async (name: string, body: unknown) => {
        if (name === 'photo-upload-session') {
          bodies.push(body);
          sessions += 1;
          return session(sessions);
        }
        return { ok: true };
      }) as unknown as UploadDeps['call'],
      uploadChunks: vi
        .fn()
        .mockRejectedValueOnce(new Error('La carga se interrumpió (503).'))
        .mockResolvedValueOnce(
          undefined,
        ) as unknown as UploadDeps['uploadChunks'],
    };
    await uploadPhoto('tok', target, () => undefined, { deps });
    expect(sessions).toBe(2);
    expect(bodies[0]).toMatchObject({ previousUploadId: undefined });
    expect(bodies[1]).toMatchObject({ previousUploadId: 'upload-1' });
  });

  it('informa el error después de agotar los intentos', async () => {
    const deps: UploadDeps = {
      call: vi.fn(async () => session(1)) as unknown as UploadDeps['call'],
      uploadChunks: vi
        .fn()
        .mockRejectedValue(
          new Error('Sin conexión'),
        ) as unknown as UploadDeps['uploadChunks'],
    };
    await expect(
      uploadPhoto('tok', target, () => undefined, { deps, attempts: 2 }),
    ).rejects.toThrow('Sin conexión');
    expect(deps.uploadChunks).toHaveBeenCalledTimes(2);
  });

  it('un link cerrado, vencido o revocado no se reintenta', async () => {
    const closed = Object.assign(new Error('Este link expiró.'), {
      code: 'link_expired',
    });
    const deps: UploadDeps = {
      call: vi.fn().mockRejectedValue(closed) as unknown as UploadDeps['call'],
      uploadChunks: vi.fn() as unknown as UploadDeps['uploadChunks'],
    };
    await expect(
      uploadPhoto('tok', target, () => undefined, { deps }),
    ).rejects.toThrow('expiró');
    expect(deps.call).toHaveBeenCalledTimes(1);
  });
});

describe('cola de subidas', () => {
  it('nunca supera el límite de concurrencia y devuelve los fallos sin rechazar', async () => {
    let active = 0;
    let peak = 0;
    const failures = await runPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (n % 3 === 0) throw new Error(`fallo ${n}`);
    });
    expect(peak).toBe(2);
    expect(failures.map((x) => x.item)).toEqual([3, 6]);
  });

  it('una lista vacía no hace nada', async () => {
    expect(await runPool([], 3, async () => undefined)).toEqual([]);
  });
});

describe('errores del servidor', () => {
  it('conserva el código para que la pantalla pueda reaccionar', () => {
    const error = new PublicOrderError(
      'Los precios cambiaron.',
      'price_changed',
    );
    expect(error.code).toBe('price_changed');
    expect(error.message).toBe('Los precios cambiaron.');
  });
});
