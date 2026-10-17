/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase joined row boundary. */
import { corsHeaders, body, errorResponse, json } from '../_shared/http.ts';
import { ensureJobFolder, putTextFile } from '../_shared/google-drive.ts';
import { validateUploadToken } from '../_shared/token.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });
  try {
    const { token } = await body<{ token: string }>(request);
    const valid = await validateUploadToken(token, true);
    if (valid.link.submitted_at)
      return json({ ok: true, alreadySubmitted: true });
    const { data: job } = await valid.service
      .from('photo_jobs')
      .select(
        'id,customers!inner(full_name),photo_job_items(id,service_name_snapshot,quantity,width_mm,height_mm,is_active)',
      )
      .eq('business_id', valid.link.business_id)
      .eq('id', valid.link.photo_job_id)
      .single();
    const { data: files } = await valid.service
      .from('photo_job_files')
      .select('*')
      .eq('business_id', valid.link.business_id)
      .eq('photo_job_id', valid.link.photo_job_id)
      .eq('status', 'uploaded')
      .order('created_at');
    if (!files?.length)
      throw new Error('Todavía no hay archivos completos para finalizar.');
    const pending = await valid.service
      .from('photo_job_files')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', valid.link.business_id)
      .eq('photo_job_id', valid.link.photo_job_id)
      .in('status', ['pending', 'uploading']);
    if ((pending.count ?? 0) > 0)
      throw new Error(
        'Esperá a que terminen todas las cargas antes de finalizar.',
      );
    const folders = await ensureJobFolder(
      valid.link.business_id,
      valid.link.photo_job_id,
    );
    const lines = [
      `Cliente: ${job.customers.full_name}`,
      `Código Job: CC-${job.id.slice(0, 8).toUpperCase()}`,
      '',
    ];
    const warnings = [];
    for (const item of (job.photo_job_items ?? []).filter(
      (x: any) => x.is_active,
    )) {
      const own = files.filter((x: any) => x.photo_job_item_id === item.id);
      if (!own.length) continue;
      const dimensions =
        item.width_mm && item.height_mm
          ? ` (${item.width_mm / 10} x ${item.height_mm / 10} cm)`
          : '';
      lines.push(`${item.service_name_snapshot}${dimensions}`);
      for (const file of own)
        lines.push(
          `${file.original_filename} | ${file.copies} ${file.copies === 1 ? 'copia' : 'copias'}`,
        );
      const copies = own.reduce(
        (sum: number, file: any) => sum + file.copies,
        0,
      );
      if (own[0].workflow_route === 'lab' && copies !== item.quantity)
        warnings.push(
          `${item.service_name_snapshot}: ${copies} copias enviadas de ${item.quantity} pedidas.`,
        );
      lines.push('');
    }
    await putTextFile(folders.token, folders.root, job.id, lines.join('\r\n'));
    const now = new Date().toISOString();
    await valid.service
      .from('photo_jobs')
      .update({ file_intake_status: 'submitted' })
      .eq('business_id', valid.link.business_id)
      .eq('id', valid.link.photo_job_id);
    await valid.service
      .from('photo_job_upload_links')
      .update({ submitted_at: now })
      .eq('id', valid.link.id)
      .is('submitted_at', null);
    return json({ ok: true, warnings });
  } catch (cause) {
    if (cause instanceof Response) return cause;
    return errorResponse(cause);
  }
});
