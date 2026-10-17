import { corsHeaders, body, errorResponse, json } from '../_shared/http.ts';
import { destinationId, validateUploadToken } from '../_shared/token.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });
  try {
    const { token } = await body<{ token: string }>(request);
    const { service, link } = await validateUploadToken(token);
    const { data: job, error } = await service
      .from('photo_jobs')
      .select(
        'id,status,file_intake_status,customers!inner(full_name),businesses!inner(name),photo_job_items(id,service_name_snapshot,quantity,width_mm,height_mm,is_active,photo_services(workflow_route,requires_customer_files))',
      )
      .eq('business_id', link.business_id)
      .eq('id', link.photo_job_id)
      .single();
    if (error || !job || ['delivered', 'cancelled'].includes(job.status))
      throw new Error('Este pedido ya no acepta archivos.');
    const destinations = [];
    for (const item of job.photo_job_items ?? []) {
      if (
        !item.is_active ||
        !item.photo_services?.requires_customer_files ||
        item.photo_services.workflow_route === 'none'
      )
        continue;
      destinations.push({
        destinationId: await destinationId(link.id, item.id),
        name: item.service_name_snapshot,
        quantity: item.quantity,
        widthMm: item.width_mm,
        heightMm: item.height_mm,
        workflowRoute: item.photo_services.workflow_route,
      });
    }
    return json({
      businessName: job.businesses.name,
      customerName: String(job.customers.full_name).trim().split(/\s+/)[0],
      orderCode: `CC-${job.id.slice(0, 8).toUpperCase()}`,
      destinations,
      expiresAt: link.expires_at,
    });
  } catch (cause) {
    if (cause instanceof Response) return cause;
    return errorResponse(cause);
  }
});
