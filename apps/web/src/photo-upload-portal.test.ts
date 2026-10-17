import { afterEach, describe, expect, it, vi } from 'vitest';
import { resumableOffset, uploadChunks } from './photo-upload-portal';

describe('cliente resumable de Google Drive', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reanuda desde el último byte confirmado y reporta progreso por archivo', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 308, headers: { Range: 'bytes=0-3' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      resumableOffset('https://upload.example/session', 8),
    ).resolves.toBe(4);
    const progress: number[] = [];
    const blob = new Blob(['12345678'], { type: 'image/jpeg' }) as File;
    await uploadChunks(
      blob,
      'https://upload.example/session',
      4,
      (value) => progress.push(value),
      4,
    );
    expect(progress).toEqual([100]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT' });
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject(
      { 'Content-Range': 'bytes 4-7/8' },
    );
  });

  it('rechaza una sesión vencida para permitir retry individual con una nueva', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 410 })),
    );
    await expect(
      resumableOffset('https://upload.example/session', 8),
    ).rejects.toThrow('venció');
  });
});
