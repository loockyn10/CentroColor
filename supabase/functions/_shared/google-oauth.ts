export const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60_000;
export const GOOGLE_DRIVE_CALLBACK_URL =
  'https://rymxlyionglffbmammfu.supabase.co/functions/v1/google-drive-oauth-callback';
export const GOOGLE_DRIVE_WEB_APP_URL = 'https://centro-color-web.vercel.app';
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export type GoogleOAuthStateRow = {
  created_at: string;
  expires_at: string;
  consumed_at?: string | null;
};

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  webAppUrl: string;
};

export class GoogleOAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

function requiredEnv(
  name: string,
  getEnv: (name: string) => string | undefined,
) {
  const value = getEnv(name)?.trim();
  if (!value)
    throw new GoogleOAuthError(
      `Falta configuración server-side: ${name}.`,
      'missing_config',
    );
  return value;
}

export function googleOAuthConfig(
  getEnv: (name: string) => string | undefined,
  includeClientSecret: boolean,
): GoogleOAuthConfig {
  const redirectUri = requiredEnv('GOOGLE_DRIVE_REDIRECT_URI', getEnv);
  if (redirectUri !== GOOGLE_DRIVE_CALLBACK_URL)
    throw new GoogleOAuthError(
      'GOOGLE_DRIVE_REDIRECT_URI no coincide con el callback desplegado.',
      'invalid_redirect_uri',
    );
  const webAppUrl = requiredEnv('WEB_APP_URL', getEnv).replace(/\/$/, '');
  let parsedWebUrl: URL;
  try {
    parsedWebUrl = new URL(webAppUrl);
  } catch {
    throw new GoogleOAuthError(
      'WEB_APP_URL no es una URL válida.',
      'invalid_web_app_url',
    );
  }
  if (parsedWebUrl.protocol !== 'https:')
    throw new GoogleOAuthError(
      'WEB_APP_URL debe usar HTTPS.',
      'invalid_web_app_url',
    );
  if (webAppUrl !== GOOGLE_DRIVE_WEB_APP_URL)
    throw new GoogleOAuthError(
      'WEB_APP_URL no coincide con la Web desplegada.',
      'invalid_web_app_url',
    );
  return {
    clientId: requiredEnv('GOOGLE_DRIVE_CLIENT_ID', getEnv),
    clientSecret: includeClientSecret
      ? requiredEnv('GOOGLE_DRIVE_CLIENT_SECRET', getEnv)
      : undefined,
    redirectUri,
    webAppUrl,
  };
}

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
      usedResult: false,
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
    expiredResult: isOauthStateExpired(state.expires_at, nowMs),
    usedResult: Boolean(state.consumed_at),
  };
}

export function isOauthStateExpired(expiresAt: string, nowMs = Date.now()) {
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs))
    throw new Error('El estado OAuth tiene una expiración inválida.');
  return expiresMs <= nowMs;
}

export function requireValidGoogleOAuthState<T extends GoogleOAuthStateRow>(
  state: T | null,
  nowMs = Date.now(),
) {
  const inspection = inspectGoogleOAuthState(state, nowMs);
  if (!state)
    throw new GoogleOAuthError(
      'La autorización OAuth no existe o ya fue utilizada.',
      'oauth_state_missing',
      403,
    );
  if (inspection.usedResult)
    throw new GoogleOAuthError(
      'La autorización OAuth ya fue utilizada.',
      'oauth_state_consumed',
      403,
    );
  if (inspection.expiredResult)
    throw new GoogleOAuthError(
      'La autorización OAuth expiró.',
      'oauth_state_expired',
      403,
    );
  return { state, inspection };
}

export function requirePersistedGoogleOAuthState<T>(
  state: T | null,
  databaseError: unknown,
) {
  if (databaseError || !state)
    throw new GoogleOAuthError(
      'No se pudo guardar el estado OAuth.',
      'oauth_state_persistence_failed',
    );
  return state;
}

export function requireVaultSecretId(data: unknown, databaseError: unknown) {
  if (databaseError || typeof data !== 'string' || !data)
    throw new GoogleOAuthError(
      'No se pudo guardar el acceso de Google en Vault.',
      'vault_save_failed',
    );
  return data;
}

export function requireOAuthCompletion<T>(
  previousSecretId: T,
  databaseError: unknown,
) {
  if (databaseError)
    throw new GoogleOAuthError(
      'No se pudo guardar la integración de Google Drive.',
      'integration_persistence_failed',
    );
  return previousSecretId;
}

export async function exchangeGoogleAuthorizationCode(
  fetcher: typeof fetch,
  config: Required<
    Pick<GoogleOAuthConfig, 'clientId' | 'clientSecret' | 'redirectUri'>
  >,
  code: string,
) {
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new GoogleOAuthError(
      'Google rechazó el intercambio OAuth.',
      `google_token_${String(payload.error ?? response.status)}`,
      502,
    );
  if (typeof payload.access_token !== 'string' || !payload.access_token)
    throw new GoogleOAuthError(
      'Google no devolvió access token.',
      'missing_access_token',
      502,
    );
  if (typeof payload.refresh_token !== 'string' || !payload.refresh_token)
    throw new GoogleOAuthError(
      'Google no entregó acceso offline. Volvé a conectar y autorizá el acceso.',
      'missing_refresh_token',
      502,
    );
  if (
    payload.token_type &&
    String(payload.token_type).toLowerCase() !== 'bearer'
  )
    throw new GoogleOAuthError(
      'Google devolvió un tipo de token inesperado.',
      'invalid_token_type',
      502,
    );
  if (payload.expires_in != null && Number(payload.expires_in) <= 0)
    throw new GoogleOAuthError(
      'Google devolvió una expiración de token inválida.',
      'invalid_token_expiry',
      502,
    );
  if (
    payload.scope &&
    !String(payload.scope).split(' ').includes(GOOGLE_DRIVE_SCOPE)
  )
    throw new GoogleOAuthError(
      'Google no concedió el permiso requerido de Drive.',
      'missing_drive_scope',
      502,
    );
  return {
    accessToken: payload.access_token as string,
    refreshToken: payload.refresh_token as string,
    expiresIn: payload.expires_in == null ? null : Number(payload.expires_in),
    tokenType: payload.token_type == null ? null : String(payload.token_type),
    scope: payload.scope == null ? null : String(payload.scope),
  };
}

export const GOOGLE_REFRESH_REVOKED_CODE = 'google_refresh_invalid_grant';

/**
 * Only `invalid_grant` means the stored refresh token is no longer usable (revoked,
 * expired or the user removed access). Every other failure (bad client credentials,
 * network, Google outage) must NOT flip the integration to reconnect_required.
 */
export async function refreshGoogleAccessToken(
  fetcher: typeof fetch,
  config: { clientId: string; clientSecret: string; refreshToken: string },
) {
  let response: Response;
  try {
    response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
  } catch {
    throw new GoogleOAuthError(
      'No se pudo contactar a Google. Reintentá en unos minutos.',
      'google_unreachable',
      503,
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (payload.error === 'invalid_grant')
      throw new GoogleOAuthError(
        'Google Drive revocó el acceso; volvé a conectar la integración.',
        GOOGLE_REFRESH_REVOKED_CODE,
        409,
      );
    throw new GoogleOAuthError(
      'Google rechazó el refresh token.',
      `google_refresh_${String(payload.error ?? response.status)}`,
      502,
    );
  }
  if (!payload.access_token)
    throw new GoogleOAuthError(
      'Google no devolvió access token.',
      'missing_access_token',
      502,
    );
  return payload.access_token as string;
}
