import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DRIVE_NETWORK_MESSAGE,
  call,
  resumableOffset,
  uploadChunks,
} from './photo-upload-client';

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

  it('reintenta tras un error de red y continúa desde el offset confirmado', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(null, { status: 308, headers: { Range: 'bytes=0-3' } }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const progress: number[] = [];
    await uploadChunks(
      new Blob(['12345678'], { type: 'image/jpeg' }) as File,
      'https://upload.example/session',
      8,
      (value) => progress.push(value),
      0,
      { sleep: async () => undefined },
    );
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).headers).toMatchObject(
      {
        'Content-Range': 'bytes 4-7/8',
      },
    );
    expect(progress.at(-1)).toBe(100);
  });

  it('tras agotar los reintentos explica el problema de conexión con Drive', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    await expect(
      uploadChunks(
        new Blob(['1234']) as File,
        'https://upload.example/session',
        4,
        () => undefined,
        0,
        { maxRetries: 2, sleep: async () => undefined },
      ),
    ).rejects.toThrow(DRIVE_NETWORK_MESSAGE);
  });

  it('no reintenta una sesión vencida (410): deja que el portal abra una nueva', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 410 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      uploadChunks(
        new Blob(['1234']) as File,
        'https://upload.example/session',
        4,
        () => undefined,
        0,
        { sleep: async () => undefined },
      ),
    ).rejects.toThrow('410');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('si el navegador no expone Range en el 308, asume el chunk aceptado completo', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 308 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 })),
    );
    const progress: number[] = [];
    await uploadChunks(
      new Blob(['12345678']) as File,
      'https://upload.example/session',
      4,
      (value) => progress.push(value),
    );
    expect(progress).toEqual([50, 100]);
  });
});

describe('call() al portal público', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('mapea fallas de red a un mensaje accionable y errores HTTP al mensaje del servidor', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://p.supabase.co');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')));
    await expect(call('photo-upload-context', { token: 't' })).rejects.toThrow(
      'Revisá tu conexión',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Este link expiró.' }), {
          status: 410,
        }),
      ),
    );
    await expect(call('photo-upload-context', { token: 't' })).rejects.toThrow(
      'Este link expiró.',
    );
  });
});
