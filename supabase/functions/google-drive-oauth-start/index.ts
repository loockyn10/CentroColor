import { corsHeaders, body, errorResponse, json } from '../_shared/http.ts';
import { googleOAuthStateWindow } from '../_shared/google-oauth.ts';
import { requireAdmin } from '../_shared/supabase.ts';
import { randomToken, sha256 } from '../_shared/token.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });
  try {
    const { businessId } = await body<{ businessId: string }>(request);
    const { user, service } = await requireAdmin(request, businessId);
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
        return_url: Deno.env.get('WEB_APP_URL')!,
        created_at: createdAt,
        expires_at: expiresAt,
      })
      .select('created_at,expires_at')
      .single();
    if (stateError || !persistedState) {
      console.error('google_drive_oauth_start_state_persist_failed', {
        stateFingerprint: stateHash.slice(0, 12),
        errorCode: stateError?.code ?? 'missing_row',
      });
      throw new Error('No se pudo crear la autorización OAuth.');
    }
    console.info('google_drive_oauth_start_state', {
      stateCreated: true,
      stateFingerprint: stateHash.slice(0, 12),
      createdAt: persistedState.created_at,
      expiresAt: persistedState.expires_at,
      now: new Date(nowMs).toISOString(),
    });
    const query = new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_DRIVE_CLIENT_ID')!,
      redirect_uri: Deno.env.get('GOOGLE_DRIVE_REDIRECT_URI')!,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return json({
      url: `https://accounts.google.com/o/oauth2/v2/auth?${query}`,
    });
  } catch (cause) {
    if (cause instanceof Response) return cause;
    return errorResponse(cause);
  }
});
