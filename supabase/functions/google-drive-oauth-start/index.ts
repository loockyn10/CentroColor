import { corsHeaders, body, errorResponse, json } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/supabase.ts';
import { randomToken, sha256 } from '../_shared/token.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });
  try {
    const { businessId } = await body<{ businessId: string }>(request);
    const { user, service } = await requireAdmin(request, businessId);
    const state = randomToken(32);
    await service.from('google_oauth_states').insert({
      state_hash: await sha256(state),
      business_id: businessId,
      user_id: user.id,
      return_url: Deno.env.get('WEB_APP_URL')!,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
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
