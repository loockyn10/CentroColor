import { describe, expect, it, vi } from 'vitest';
import { refreshGoogleAccessToken } from './google-oauth';

describe('Google OAuth refresh', () => {
  it('obtiene access token server-side con fetch mockeado', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'access' }), {
        status: 200,
      }),
    );
    await expect(
      refreshGoogleAccessToken(fetcher, {
        clientId: 'client',
        clientSecret: 'secret',
        refreshToken: 'refresh',
      }),
    ).resolves.toBe('access');
    expect(String((fetcher.mock.calls[0]?.[1] as RequestInit).body)).toContain(
      'grant_type=refresh_token',
    );
  });
  it('rechaza refresh revocado', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 400 }));
    await expect(
      refreshGoogleAccessToken(fetcher, {
        clientId: 'c',
        clientSecret: 's',
        refreshToken: 'r',
      }),
    ).rejects.toThrow('refresh token');
  });
});
