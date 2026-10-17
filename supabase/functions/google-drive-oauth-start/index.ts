import {
  ApiError,
  body,
  errorResponse,
  json,
  preflight,
} from '../_shared/http.ts';
import { oauthRequestId, safeDatabaseError } from '../_shared/diagnostics.ts';
import {
  GOOGLE_DRIVE_SCOPE,
  GoogleOAuthError,
  googleOAuthConfig,
  googleOAuthStateWindow,
  requirePersistedGoogleOAuthState,
} from '../_shared/google-oauth.ts';
import { requireAdmin } from '../_shared/supabase.ts';
import { randomToken, sha256 } from '../_shared/token.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const requestId = oauthRequestId();
  if (request.method === 'OPTIONS') return preflight();
  try {
    const { businessId } = await body<{ businessId: string }>(request);
    if (typeof businessId !== 'string' || !UUID.test(businessId))
      throw new ApiError('Falta el negocio.', 400, 'invalid_business');
    console.info('google_drive_oauth_start_received', {
      requestId,
      authPresent: request.headers.has('Authorization'),
      businessId,
    });
    const { user, membership, service } = await requireAdmin(
      request,
      businessId,
    );
    console.info('google_drive_oauth_start_authorized', {
      requestId,
      userId: user.id,
      businessId,
      membershipRole: membership.role,
    });
    const config = googleOAuthConfig((name) => Deno.env.get(name), false);
    const state = randomToken(32);
    const stateHash = await sha256(state);
    const nowMs = Date.now();
    const { createdAt, expiresAt } = googleOAuthStateWindow(nowMs);
    const { data: persistedState, error: stateError } = await service
      .from('google_oauth_states')
      .insert({
        state_hash: stateHash,
        business_id: businessId,
        user_id: user.id,
        return_url: config.webAppUrl,
        created_at: createdAt,
        expires_at: expiresAt,
      })
      .select('created_at,expires_at')
      .single();
    if (stateError || !persistedState) {
      console.error('google_drive_oauth_start_state_persist_failed', {
        requestId,
        stateFingerprint: stateHash.slice(0, 12),
        databaseError: safeDatabaseError(stateError),
      });
    }
    requirePersistedGoogleOAuthState(persistedState, stateError);
    console.info('google_drive_oauth_start_state', {
      requestId,
      stateCreated: true,
      stateFingerprint: stateHash.slice(0, 12),
      createdAt: persistedState.created_at,
      expiresAt: persistedState.expires_at,
      now: new Date(nowMs).toISOString(),
    });
    const query = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: GOOGLE_DRIVE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return json({
      url: `https://accounts.google.com/o/oauth2/v2/auth?${query}`,
    });
  } catch (cause) {
    console.error('google_drive_oauth_start_failed', {
      requestId,
      errorCode:
        cause instanceof GoogleOAuthError ? cause.code : 'unexpected_error',
      message: cause instanceof Error ? cause.message : 'Unknown error',
    });
    return errorResponse(cause, {
      requestId,
      context: 'google_drive_oauth_start',
    });
  }
});
