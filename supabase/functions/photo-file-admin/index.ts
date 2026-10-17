import { corsHeaders, body, errorResponse, json } from '../_shared/http.ts';
import { accessForBusiness } from '../_shared/google-drive.ts';
import { requireAdmin } from '../_shared/supabase.ts';
import { randomToken, sha256 } from '../_shared/token.ts';

type Payload = {
  action: 'status' | 'create_link' | 'get_link' | 'revoke_link' | 'disconnect';
  businessId: string;
  photoJobId?: string;
};
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });
  try {
    const input = await body<Payload>(request);
    const { user, service } = await requireAdmin(request, input.businessId);
    if (input.action === 'status') {
      const { data } = await service
        .from('google_drive_integrations')
        .select('status,google_account_email,root_folder_id,connected_at')
        .eq('business_id', input.businessId)
        .maybeSingle();
      return json(
        data ?? {
          status: 'disconnected',
          google_account_email: null,
          root_folder_id: null,
          connected_at: null,
        },
      );
    }
    if (input.action === 'disconnect') {
      const { data } = await service
        .from('google_drive_integrations')
        .select('*')
        .eq('business_id', input.businessId)
        .maybeSingle();
      if (data) {
        const { data: refresh } = await service.rpc(
          'cc_read_google_refresh_token',
          { p_secret_id: data.refresh_token_secret_id },
        );
        if (refresh)
          await fetch(
            `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`,
            { method: 'POST' },
          ).catch(() => undefined);
        await service.rpc('cc_delete_google_refresh_token', {
          p_secret_id: data.refresh_token_secret_id,
        });
        await service
          .from('google_drive_integrations')
          .update({
            status: 'disconnected',
            disconnected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('business_id', input.businessId);
      }
      return json({ ok: true });
    }
    if (!input.photoJobId) throw new Error('Falta el trabajo fotográfico.');
    const { data: job } = await service
      .from('photo_jobs')
      .select('id,business_id,file_intake_status')
      .eq('business_id', input.businessId)
      .eq('id', input.photoJobId)
      .maybeSingle();
    if (!job) throw new Error('No se encontró el trabajo.');
    if (input.action === 'get_link') {
      const { data } = await service
        .from('photo_job_upload_links')
        .select('id,expires_at,revoked_at,submitted_at,created_at')
        .eq('business_id', input.businessId)
        .eq('photo_job_id', input.photoJobId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return json(data ? { ...data, url: null } : null);
    }
    if (input.action === 'revoke_link') {
      await service
        .from('photo_job_upload_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('business_id', input.businessId)
        .eq('photo_job_id', input.photoJobId)
        .is('revoked_at', null);
      return json({ ok: true });
    }
    await accessForBusiness(input.businessId);
    const { data: uploadItems } = await service
      .from('photo_job_items')
      .select(
        'id,is_active,photo_services!inner(workflow_route,requires_customer_files)',
      )
      .eq('business_id', input.businessId)
      .eq('photo_job_id', input.photoJobId)
      .eq('is_active', true)
      .eq('photo_services.requires_customer_files', true)
      .neq('photo_services.workflow_route', 'none');
    if (!uploadItems?.length)
      throw new Error(
        'Este trabajo no tiene servicios configurados para recibir archivos.',
      );
    await service
      .from('photo_job_upload_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('business_id', input.businessId)
      .eq('photo_job_id', input.photoJobId)
      .is('revoked_at', null);
    const token = randomToken(32);
    const days = Number(Deno.env.get('PHOTO_UPLOAD_LINK_DAYS') ?? '14');
    const expiresAt = new Date(
      Date.now() + Math.max(1, Math.min(days, 90)) * 86_400_000,
    ).toISOString();
    const { data: link, error } = await service
      .from('photo_job_upload_links')
      .insert({
        business_id: input.businessId,
        photo_job_id: input.photoJobId,
        token_hash: await sha256(token),
        created_by: user.id,
        expires_at: expiresAt,
      })
      .select('id,expires_at,revoked_at,submitted_at')
      .single();
    if (error) throw error;
    await service
      .from('photo_jobs')
      .update({ file_intake_status: 'awaiting_files' })
      .eq('business_id', input.businessId)
      .eq('id', input.photoJobId);
    const base = (
      Deno.env.get('PUBLIC_WEB_URL') ?? Deno.env.get('WEB_APP_URL')!
    ).replace(/\/$/, '');
    return json({ ...link, url: `${base}/enviar/${token}` });
  } catch (cause) {
    if (cause instanceof Response) return cause;
    return errorResponse(cause);
  }
});
