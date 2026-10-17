import { describe, expect, it, vi } from 'vitest';
import { ensureRootFolder } from './google-drive-root';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Google Drive root folder', () => {
  it('reutiliza el root_folder_id persistido', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'root-existing',
        name: 'Renombrada',
        mimeType: 'application/vnd.google-apps.folder',
        trashed: false,
      }),
    );
    await expect(
      ensureRootFolder('access', 'business-1', 'root-existing', fetcher),
    ).resolves.toMatchObject({ id: 'root-existing' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('busca por appProperties antes de crear una carpeta', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'root-created',
          name: 'CentroColor',
          webViewLink: 'https://drive.google.com/root-created',
        }),
      );
    await expect(
      ensureRootFolder('access', 'business-1', null, fetcher),
    ).resolves.toMatchObject({ id: 'root-created' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const createInit = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(createInit.method).toBe('POST');
    expect(String(createInit.body)).toContain('centrocolor_root');
  });

  it('reutiliza una carpeta encontrada por identidad estable', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        files: [
          {
            id: 'root-by-property',
            name: 'CentroColor',
            mimeType: 'application/vnd.google-apps.folder',
            trashed: false,
          },
        ],
      }),
    );
    await expect(
      ensureRootFolder('access', 'business-1', null, fetcher),
    ).resolves.toMatchObject({ id: 'root-by-property' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
