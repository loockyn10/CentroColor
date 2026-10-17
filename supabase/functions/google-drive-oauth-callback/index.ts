import { oauthRequestId, safeDatabaseError } from '../_shared/diagnostics.ts';
import { ensureRootFolder } from '../_shared/google-drive-root.ts';
import {
  exchangeGoogleAuthorizationCode,
  GOOGLE_DRIVE_WEB_APP_URL,
  GoogleOAuthError,
  googleOAuthConfig,
  inspectGoogleOAuthState,
  requireOAuthCompletion,
  requireVaultSecretId,
  requireValidGoogleOAuthState,
} from '../_shared/google-oauth.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { sha256 } from '../_shared/token.ts';

function webRedirect(
  base: string,
  status: 'connected' | 'error',
  message?: string,
) {
  const target = new URL(base);
  target.searchParams.set('googleDrive', status);
  if (message) target.searchParams.set('message', message);
  return Response.redirect(target.toString(), 302);
}

Deno.serve(async (request) => {
  const requestId = oauthRequestId();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const googleError = url.searchParams.get('error');
  let fallback = GOOGLE_DRIVE_WEB_APP_URL;
  try {
    console.info('google_drive_oauth_callback_received', {
      requestId,
      codePresent: Boolean(code),
      statePresent: Boolean(state),
      googleErrorPresent: Boolean(googleError),
    });
    const config = googleOAuthConfig((name) => Deno.env.get(name), true);
    fallback = config.webAppUrl;
    const service = serviceClient();
    if (googleError)
      throw new GoogleOAuthError(
        'Google no autorizó el acceso a Drive.',
        `google_authorization_${googleError}`,
        400,
      );
    if (!code || !state)
      throw new GoogleOAuthError(
        'Google no devolvió autorización.',
        'missing_code_or_state',
        400,
      );
    const hash = await sha256(state);
    const { data: pending, error: stateError } = await service
      .from('google_oauth_states')
      .select(
        'state_hash,business_id,user_id,return_url,created_at,expires_at,consumed_at',
      )
      .eq('state_hash', hash)
      .maybeSingle();
    const nowMs = Date.now();
    const inspection = inspectGoogleOAuthState(pending, nowMs);
    console.info('google_drive_oauth_callback_state', {
      requestId,
      stateFingerprint: hash.slice(0, 12),
      stateFound: inspection.stateFound,
      createdAt: inspection.createdAt,
      expiresAt: inspection.expiresAt,
      now: inspection.now,
      differenceMs: inspection.differenceMs,
      expiredResult: inspection.expiredResult,
      usedResult: inspection.usedResult,
      lookupError: stateError ? safeDatabaseError(stateError) : null,
    });
    if (stateError)
      throw new GoogleOAuthError(
        'No se pudo validar el estado OAuth.',
        'oauth_state_lookup_failed',
      );
    requireValidGoogleOAuthState(pending, nowMs);

    let tokens;
    try {
      tokens = await exchangeGoogleAuthorizationCode(
        fetch,
        {
          clientId: config.clientId,
          clientSecret: config.clientSecret!,
          redirectUri: config.redirectUri,
        },
        code,
      );
      console.info('google_drive_oauth_callback_token_exchange', {
        requestId,
        success: true,
        refreshTokenPresent: true,
        expiresInPresent: tokens.expiresIn !== null,
        tokenType: tokens.tokenType,
        scopePresent: tokens.scope !== null,
      });
    } catch (cause) {
      console.error('google_drive_oauth_callback_token_exchange', {
        requestId,
        success: false,
        refreshTokenPresent: false,
        errorCode:
          cause instanceof GoogleOAuthError ? cause.code : 'unexpected_error',
      });
      throw cause;
    }

    const { data: previous, error: previousError } = await service
      .from('google_drive_integrations')
      .select('root_folder_id')
      .eq('business_id', pending!.business_id)
      .maybeSingle();
    if (previousError) {
      console.error('google_drive_oauth_callback_previous_integration_failed', {
        requestId,
        databaseError: safeDatabaseError(previousError),
      });
      throw new GoogleOAuthError(
        'No se pudo consultar la integración anterior.',
        'previous_integration_lookup_failed',
      );
    }

    let root: { id: string };
    try {
      root = await ensureRootFolder(
        tokens.accessToken,
        pending!.business_id,
        previous?.root_folder_id,
      );
      console.info('google_drive_oauth_callback_root_folder', {
        requestId,
        success: true,
        reusedStoredFolder: root.id === previous?.root_folder_id,
      });
    } catch (cause) {
      console.error('google_drive_oauth_callback_root_folder', {
        requestId,
        success: false,
        message: cause instanceof Error ? cause.message : 'Unknown Drive error',
      });
      throw new GoogleOAuthError(
        'No se pudo crear o recuperar la carpeta CentroColor.',
        'drive_root_folder_failed',
        502,
      );
    }

    const aboutResponse = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
    );
    const about = aboutResponse.ok ? await aboutResponse.json() : null;
    const { data: secretId, error: vaultError } = await service.rpc(
      'cc_store_google_refresh_token',
      {
        p_token: tokens.refreshToken,
        p_name: `google-drive-${pending!.business_id}-${crypto.randomUUID()}`,
      },
    );
    if (vaultError || typeof secretId !== 'string' || !secretId) {
      console.error('google_drive_oauth_callback_vault_save', {
        requestId,
        success: false,
        databaseError: vaultError ? safeDatabaseError(vaultError) : null,
        secretIdReturned: Boolean(secretId),
      });
    }
    const storedSecretId = requireVaultSecretId(secretId, vaultError);
    console.info('google_drive_oauth_callback_vault_save', {
      requestId,
      success: true,
    });

    const { data: previousSecretId, error: completionError } =
      await service.rpc('cc_complete_google_drive_oauth', {
        p_state_hash: hash,
        p_google_account_email: about?.user?.emailAddress ?? null,
        p_root_folder_id: root.id,
        p_refresh_token_secret_id: storedSecretId,
      });
    if (completionError) {
      console.error('google_drive_oauth_callback_integration_upsert', {
        requestId,
        success: false,
        databaseError: safeDatabaseError(completionError),
      });
      const { error: cleanupError } = await service.rpc(
        'cc_delete_google_refresh_token',
        { p_secret_id: storedSecretId },
      );
      console.info('google_drive_oauth_callback_new_secret_cleanup', {
        requestId,
        success: !cleanupError,
        databaseError: cleanupError ? safeDatabaseError(cleanupError) : null,
      });
    }
    requireOAuthCompletion(previousSecretId, completionError);
    console.info('google_drive_oauth_callback_integration_upsert', {
      requestId,
      success: true,
      stateConsumed: true,
      previousSecretRemoved: typeof previousSecretId === 'string',
    });
    return webRedirect(pending!.return_url, 'connected');
  } catch (cause) {
    const internalMessage =
      cause instanceof Error ? cause.message : 'Unknown OAuth error';
    const publicMessage =
      cause instanceof GoogleOAuthError
        ? cause.message
        : 'No se pudo completar la conexión con Google Drive.';
    console.error('google_drive_oauth_callback_failed', {
      requestId,
      errorCode:
        cause instanceof GoogleOAuthError ? cause.code : 'unexpected_error',
      message: internalMessage,
    });
    return webRedirect(fallback, 'error', publicMessage);
  }
});
