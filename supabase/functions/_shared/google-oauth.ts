export const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60_000;

export type GoogleOAuthStateRow = {
  created_at: string;
  expires_at: string;
};

export function googleOAuthStateWindow(nowMs = Date.now()) {
  return {
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + GOOGLE_OAUTH_STATE_TTL_MS).toISOString(),
  };
}

export function inspectGoogleOAuthState(
  state: GoogleOAuthStateRow | null,
  nowMs = Date.now(),
) {
  if (!state)
    return {
      stateFound: false,
      createdAt: null,
      expiresAt: null,
      now: new Date(nowMs).toISOString(),
      differenceMs: null,
      expiredResult: false,
    };

  const expiresMs = Date.parse(state.expires_at);
  if (!Number.isFinite(expiresMs))
    throw new Error('El estado OAuth tiene una expiración inválida.');
  return {
    stateFound: true,
    createdAt: state.created_at,
    expiresAt: state.expires_at,
    now: new Date(nowMs).toISOString(),
    differenceMs: expiresMs - nowMs,
    expiredResult: expiresMs <= nowMs,
  };
}

export function requireValidGoogleOAuthState<T extends GoogleOAuthStateRow>(
  state: T | null,
  nowMs = Date.now(),
) {
  const inspection = inspectGoogleOAuthState(state, nowMs);
  if (!state)
    throw new Error('La autorización OAuth no existe o ya fue utilizada.');
  if (inspection.expiredResult)
    throw new Error('La autorización OAuth expiró.');
  return { state, inspection };
}

export async function refreshGoogleAccessToken(
  fetcher: typeof fetch,
  config: { clientId: string; clientSecret: string; refreshToken: string },
) {
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error('Google rechazó el refresh token.');
  const payload = await response.json();
  if (!payload.access_token)
    throw new Error('Google no devolvió access token.');
  return payload.access_token as string;
}
