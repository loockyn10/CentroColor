import { describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_OAUTH_STATE_TTL_MS,
  googleOAuthStateWindow,
  inspectGoogleOAuthState,
  refreshGoogleAccessToken,
  requireValidGoogleOAuthState,
} from './google-oauth';

const nowMs = Date.UTC(2026, 9, 17, 12, 0, 0);

function freshState() {
  const window = googleOAuthStateWindow(nowMs);
  return { created_at: window.createdAt, expires_at: window.expiresAt };
}

describe('Google OAuth state', () => {
  it('usa milisegundos y crea una ventana exacta de 10 minutos', () => {
    const window = googleOAuthStateWindow(nowMs);
    expect(Date.parse(window.createdAt)).toBe(nowMs);
    expect(Date.parse(window.expiresAt)).toBe(
      nowMs + GOOGLE_OAUTH_STATE_TTL_MS,
    );
    expect(GOOGLE_OAUTH_STATE_TTL_MS).toBe(600_000);
  });

  it('acepta un state recién creado y un minuto después', () => {
    expect(
      requireValidGoogleOAuthState(freshState(), nowMs).state,
    ).toBeTruthy();
    expect(
      requireValidGoogleOAuthState(freshState(), nowMs + 60_000).state,
    ).toBeTruthy();
  });

  it('acepta un state inmediatamente antes de expires_at', () => {
    expect(
      requireValidGoogleOAuthState(
        freshState(),
        nowMs + GOOGLE_OAUTH_STATE_TTL_MS - 1,
      ).inspection.expiredResult,
    ).toBe(false);
  });

  it('rechaza un state en o después de expires_at', () => {
    expect(() =>
      requireValidGoogleOAuthState(
        freshState(),
        nowMs + GOOGLE_OAUTH_STATE_TTL_MS,
      ),
    ).toThrow('expiró');
    expect(() =>
      requireValidGoogleOAuthState(
        freshState(),
        nowMs + GOOGLE_OAUTH_STATE_TTL_MS + 1,
      ),
    ).toThrow('expiró');
  });

  it('rechaza un state ya consumido', () => {
    const consumedState = null;
    expect(() => requireValidGoogleOAuthState(consumedState, nowMs)).toThrow(
      'no existe o ya fue utilizada',
    );
  });

  it('rechaza un state inexistente', () => {
    expect(() => requireValidGoogleOAuthState(null, nowMs)).toThrow(
      'no existe o ya fue utilizada',
    );
  });

  it('expone differenceMs sin mezclar epoch seconds con milliseconds', () => {
    expect(inspectGoogleOAuthState(freshState(), nowMs + 60_000)).toMatchObject(
      {
        differenceMs: 540_000,
        expiredResult: false,
      },
    );
  });
});

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
