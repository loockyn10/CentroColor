import { createFolder, driveFile } from '../_shared/google-drive.ts';
import { sha256 } from '../_shared/token.ts';
import { serviceClient } from '../_shared/supabase.ts';

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const service = serviceClient();
  const fallback = Deno.env.get('WEB_APP_URL')!;
  try {
    if (!code || !state) throw new Error('Google no devolvió autorización.');
    const hash = await sha256(state);
    const { data: pending } = await service
      .from('google_oauth_states')
      .select('*')
      .eq('state_hash', hash)
      .maybeSingle();
    if (!pending || Date.parse(pending.expires_at) <= Date.now())
      throw new Error('La autorización OAuth expiró.');
    await service.from('google_oauth_states').delete().eq('state_hash', hash);
    const form = new URLSearchParams({
      code,
      client_id: Deno.env.get('GOOGLE_DRIVE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET')!,
      redirect_uri: Deno.env.get('GOOGLE_DRIVE_REDIRECT_URI')!,
      grant_type: 'authorization_code',
    });
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: form,
    });
    if (!tokenResponse.ok)
      throw new Error('Google rechazó el intercambio OAuth.');
    const tokens = await tokenResponse.json();
    if (!tokens.refresh_token)
      throw new Error(
        'Google no entregó acceso offline. Volvé a conectar y autorizá el acceso.',
      );
    const { data: previous } = await service
      .from('google_drive_integrations')
      .select('refresh_token_secret_id,root_folder_id')
      .eq('business_id', pending.business_id)
      .maybeSingle();
    let root: { id: string } | null = null;
    if (previous?.root_folder_id) {
      try {
        root = await driveFile(tokens.access_token, previous.root_folder_id);
      } catch {
        root = null;
      }
    }
    root ??= await createFolder(tokens.access_token, 'CentroColor', undefined, {
      centrocolor_root: pending.business_id,
    });
    const aboutResponse = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    const about = aboutResponse.ok ? await aboutResponse.json() : null;
    const { data: secretId, error: vaultError } = await service.rpc(
      'cc_store_google_refresh_token',
      {
        p_token: tokens.refresh_token,
        p_name: `google-drive-${pending.business_id}-${crypto.randomUUID()}`,
      },
    );
    if (vaultError || !secretId)
      throw new Error('No se pudo guardar el acceso de Google en Vault.');
    await service.from('google_drive_integrations').upsert({
      business_id: pending.business_id,
      google_account_email: about?.user?.emailAddress ?? null,
      root_folder_id: root.id,
      refresh_token_secret_id: secretId,
      connected_by: pending.user_id,
      connected_at: new Date().toISOString(),
      disconnected_at: null,
      status: 'connected',
      updated_at: new Date().toISOString(),
    });
    if (
      previous?.refresh_token_secret_id &&
      previous.refresh_token_secret_id !== secretId
    )
      await service.rpc('cc_delete_google_refresh_token', {
        p_secret_id: previous.refresh_token_secret_id,
      });
    return Response.redirect(
      `${pending.return_url}?googleDrive=connected`,
      302,
    );
  } catch (cause) {
    const message = encodeURIComponent(
      cause instanceof Error ? cause.message : 'Falló Google Drive OAuth.',
    );
    return Response.redirect(
      `${fallback}?googleDrive=error&message=${message}`,
      302,
    );
  }
});
