import { describe, expect, it } from 'vitest';
import { driveFileError, sha256Hex, uploadLinkError } from './upload-policy';

describe('seguridad del portal público', () => {
  it('hashea el token sin conservar el valor real', async () => {
    const hash = await sha256Hex('token-secreto');
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain('token-secreto');
  });
  it('rechaza links revocados, expirados y enviados', () => {
    const base = { revoked_at: null, expires_at: null, submitted_at: null };
    expect(uploadLinkError({ ...base, revoked_at: '2026-01-01' })).toContain(
      'revocado',
    );
    expect(
      uploadLinkError(
        { ...base, expires_at: '2026-01-01' },
        Date.parse('2026-01-02'),
      ),
    ).toContain('expiró');
    expect(uploadLinkError({ ...base, submitted_at: '2026-01-01' })).toContain(
      'finalizado',
    );
    expect(uploadLinkError(base)).toBeNull();
  });
  it('finalize exige parent y tamaño reales de Drive', () => {
    expect(
      driveFileError(
        { parents: ['folder'], size: '10' },
        { folderId: 'folder', sizeBytes: 10 },
      ),
    ).toBeNull();
    expect(
      driveFileError(
        { parents: ['other'], size: '10' },
        { folderId: 'folder', sizeBytes: 10 },
      ),
    ).toContain('carpeta');
    expect(
      driveFileError(
        { parents: ['folder'], size: '9' },
        { folderId: 'folder', sizeBytes: 10 },
      ),
    ).toContain('tamaño');
  });
});
