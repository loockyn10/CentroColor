import { describe, expect, it, vi } from 'vitest';
import { errorResponse } from './http';
import {
  exchangeGoogleAuthorizationCode,
  GOOGLE_DRIVE_CALLBACK_URL,
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_DRIVE_WEB_APP_URL,
  GOOGLE_OAUTH_STATE_TTL_MS,
  googleOAuthConfig,
  googleOAuthStateWindow,
  inspectGoogleOAuthState,
  isOauthStateExpired,
  refreshGoogleAccessToken,
  requireOAuthCompletion,
  requirePersistedGoogleOAuthState,
  requireValidGoogleOAuthState,
  requireVaultSecretId,
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
    const consumedState = {
      ...freshState(),
      consumed_at: new Date(nowMs + 1_000).toISOString(),
    };
    expect(() => requireValidGoogleOAuthState(consumedState, nowMs)).toThrow(
      'ya fue utilizada',
    );
  });

  it('rechaza un state inexistente', () => {
    expect(() => requireValidGoogleOAuthState(null, nowMs)).toThrow(
      'no existe o ya fue utilizada',
    );
  });

  it('permite retry antes del consumo y bloquea un callback repetido después', () => {
    const pending = freshState();
    expect(requireValidGoogleOAuthState(pending, nowMs).state).toBe(pending);
    expect(requireValidGoogleOAuthState(pending, nowMs + 1_000).state).toBe(
      pending,
    );
    expect(() =>
      requireValidGoogleOAuthState(
        {
          ...pending,
          consumed_at: new Date(nowMs + 2_000).toISOString(),
        },
        nowMs + 3_000,
      ),
    ).toThrow('ya fue utilizada');
  });

  it('expone differenceMs sin mezclar epoch seconds con milliseconds', () => {
    expect(inspectGoogleOAuthState(freshState(), nowMs + 60_000)).toMatchObject(
      {
        differenceMs: 540_000,
        expiredResult: false,
      },
    );
  });

  it('isOauthStateExpired compara timestamps PostgreSQL en milisegundos', () => {
    expect(isOauthStateExpired(freshState().expires_at, nowMs + 599_999)).toBe(
      false,
    );
    expect(isOauthStateExpired(freshState().expires_at, nowMs + 600_000)).toBe(
      true,
    );
  });

  it('propaga el fallo de persistencia y acepta una fila confirmada', () => {
    expect(requirePersistedGoogleOAuthState(freshState(), null)).toBeTruthy();
    expect(() =>
      requirePersistedGoogleOAuthState(null, { code: '42501' }),
    ).toThrow('guardar el estado OAuth');
  });

  it('reporta un fallo DB de state como 500 y no como 403', () => {
    try {
      requirePersistedGoogleOAuthState(null, { code: '42501' });
      throw new Error('El test debía fallar.');
    } catch (error) {
      expect(errorResponse(error).status).toBe(500);
    }
  });
});

describe('Google OAuth config', () => {
  const values: Record<string, string> = {
    GOOGLE_DRIVE_CLIENT_ID: 'client',
    GOOGLE_DRIVE_CLIENT_SECRET: 'secret',
    GOOGLE_DRIVE_REDIRECT_URI: GOOGLE_DRIVE_CALLBACK_URL,
    WEB_APP_URL: GOOGLE_DRIVE_WEB_APP_URL,
  };
  const env = (name: string) => values[name];

  it('valida los nombres y URLs exactos requeridos', () => {
    expect(googleOAuthConfig(env, true)).toEqual({
      clientId: 'client',
      clientSecret: 'secret',
      redirectUri: GOOGLE_DRIVE_CALLBACK_URL,
      webAppUrl: GOOGLE_DRIVE_WEB_APP_URL,
    });
  });

  it('rechaza configuración faltante o redirect URI distinto', () => {
    expect(() => googleOAuthConfig(() => undefined, true)).toThrow(
      'GOOGLE_DRIVE_REDIRECT_URI',
    );
    expect(() =>
      googleOAuthConfig(
        (name) =>
          name === 'GOOGLE_DRIVE_REDIRECT_URI'
            ? 'https://example.com/callback'
            : values[name],
        true,
      ),
    ).toThrow('no coincide');
    expect(() =>
      googleOAuthConfig(
        (name) =>
          name === 'GOOGLE_DRIVE_CLIENT_SECRET' ? undefined : values[name],
        true,
      ),
    ).toThrow('GOOGLE_DRIVE_CLIENT_SECRET');
  });
});

describe('Google OAuth code exchange', () => {
  const config = {
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: GOOGLE_DRIVE_CALLBACK_URL,
  };

  it('acepta tokens válidos sin exponerlos en la URL', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: GOOGLE_DRIVE_SCOPE,
        }),
        { status: 200 },
      ),
    );
    await expect(
      exchangeGoogleAuthorizationCode(fetcher, config, 'code'),
    ).resolves.toMatchObject({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 3600,
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://oauth2.googleapis.com/token');
    expect(String(init.body)).toContain(
      `redirect_uri=${encodeURIComponent(GOOGLE_DRIVE_CALLBACK_URL)}`,
    );
  });

  it('propaga rechazo de Google y refresh token faltante', async () => {
    await expect(
      exchangeGoogleAuthorizationCode(
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: 'invalid_grant' }), {
            status: 400,
          }),
        ),
        config,
        'code',
      ),
    ).rejects.toMatchObject({ code: 'google_token_invalid_grant' });
    await expect(
      exchangeGoogleAuthorizationCode(
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              access_token: 'access',
              token_type: 'Bearer',
            }),
            { status: 200 },
          ),
        ),
        config,
        'code',
      ),
    ).rejects.toMatchObject({ code: 'missing_refresh_token' });
  });
});

describe('Google OAuth persistence boundaries', () => {
  it('valida success/failure de Vault', () => {
    expect(requireVaultSecretId('secret-id', null)).toBe('secret-id');
    expect(() => requireVaultSecretId(null, { code: 'vault_error' })).toThrow(
      'Vault',
    );
  });

  it('valida success/failure del upsert atómico', () => {
    expect(requireOAuthCompletion('previous-id', null)).toBe('previous-id');
    expect(() =>
      requireOAuthCompletion(null, { code: 'integration_error' }),
    ).toThrow('integración');
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
  it('invalid_grant se distingue de otros rechazos para poder pedir reconexión', async () => {
    const config = { clientId: 'c', clientSecret: 's', refreshToken: 'r' };
    const reply = (error: string, status: number) =>
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ error }), { status }));
    await expect(
      refreshGoogleAccessToken(reply('invalid_grant', 400), config),
    ).rejects.toMatchObject({
      code: 'google_refresh_invalid_grant',
      status: 409,
    });
    await expect(
      refreshGoogleAccessToken(reply('invalid_client', 401), config),
    ).rejects.toMatchObject({
      code: 'google_refresh_invalid_client',
      status: 502,
    });
    await expect(
      refreshGoogleAccessToken(
        vi.fn().mockRejectedValue(new TypeError('network')),
        config,
      ),
    ).rejects.toMatchObject({ code: 'google_unreachable', status: 503 });
  });
});
