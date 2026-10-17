/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase joined row boundary. */
import { corsHeaders, body, errorResponse, json } from '../_shared/http.ts';
import {
  ensureJobFolder,
  generateDriveFileId,
  initializeResumable,
  sanitizeName,
} from '../_shared/google-drive.ts';
import { destinationId, validateUploadToken } from '../_shared/token.ts';

const extensions = new Set([
  'jpg',
  'jpeg',
  'png',
  'heic',
  'heif',
  'tif',
  'tiff',
  'dng',
  'cr2',
  'cr3',
  'nef',
  'arw',
  'orf',
  'rw2',
  'raf',
]);
type Input = {
  token: string;
  destinationId: string;
  filename: string;
  mimeType?: string;
  sizeBytes: number;
  copies?: number;
  previousUploadId?: string;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });
  try {
    const input = await body<Input>(request);
    const valid = await validateUploadToken(input.token);
    const max = Number(
      Deno.env.get('PHOTO_UPLOAD_MAX_BYTES') ?? String(2 * 1024 * 1024 * 1024),
    );
    const filename = sanitizeName(input.filename);
    const extension = filename.split('.').pop()?.toLowerCase() ?? '';
    if (!extensions.has(extension))
      throw new Error('Formato de archivo no admitido.');
    const mime = (input.mimeType || 'application/octet-stream').toLowerCase();
    if (!mime.startsWith('image/') && mime !== 'application/octet-stream')
      throw new Error(
        'El tipo MIME no coincide con un archivo fotográfico admitido.',
      );
    if (
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.sizeBytes > max
    )
      throw new Error('El tamaño del archivo no está permitido.');
    const copies = input.copies ?? 1;
    if (!Number.isInteger(copies) || copies <= 0 || copies > 9999)
      throw new Error('Cantidad de copias inválida.');
    const { data: items } = await valid.service
      .from('photo_job_items')
      .select(
        'id,is_active,photo_services(workflow_route,requires_customer_files)',
      )
      .eq('business_id', valid.link.business_id)
      .eq('photo_job_id', valid.link.photo_job_id);
    let item: any = null;
    for (const candidate of items ?? []) {
      if (
        (await destinationId(valid.link.id, candidate.id)) ===
        input.destinationId
      )
        item = candidate;
    }
    if (
      !item ||
      !item.is_active ||
      !item.photo_services?.requires_customer_files ||
      item.photo_services.workflow_route === 'none'
    )
      throw new Error('El destino no pertenece a este pedido.');
    const count = await valid.service
      .from('photo_job_files')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', valid.link.business_id)
      .eq('photo_job_id', valid.link.photo_job_id)
      .neq('status', 'removed');
    if ((count.count ?? 0) >= 500)
      throw new Error('Este pedido alcanzó el máximo de archivos.');
    const recent = await valid.service
      .from('photo_job_files')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', valid.link.business_id)
      .eq('photo_job_id', valid.link.photo_job_id)
      .gte('created_at', new Date(Date.now() - 60_000).toISOString());
    if ((recent.count ?? 0) >= 30)
      throw new Error(
        'Hay demasiadas cargas simultáneas. Esperá un minuto y reintentá.',
      );
    if (input.previousUploadId)
      await valid.service
        .from('photo_job_files')
        .update({ status: 'failed' })
        .eq('id', input.previousUploadId)
        .eq('business_id', valid.link.business_id)
        .eq('photo_job_id', valid.link.photo_job_id)
        .in('status', ['pending', 'uploading']);
    const folders = await ensureJobFolder(
      valid.link.business_id,
      valid.link.photo_job_id,
      item.id,
    );
    const driveId = await generateDriveFileId(folders.token);
    const stored = `${crypto.randomUUID().slice(0, 8)}-${filename}`;
    const { data: file, error } = await valid.service
      .from('photo_job_files')
      .insert({
        business_id: valid.link.business_id,
        photo_job_id: valid.link.photo_job_id,
        photo_job_item_id: item.id,
        drive_file_id: driveId,
        drive_folder_id: folders.folder,
        original_filename: filename,
        stored_filename: stored,
        mime_type: input.mimeType || null,
        size_bytes: input.sizeBytes,
        copies,
        workflow_route: folders.route,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw error;
    let uploadUrl: string;
    try {
      uploadUrl = await initializeResumable(
        folders.token,
        {
          id: driveId,
          name: stored,
          parents: [folders.folder],
          appProperties: {
            centrocolor_job_id: valid.link.photo_job_id,
            centrocolor_item_id: item.id,
            centrocolor_upload_id: file.id,
            original_filename: filename,
            copies: String(copies),
          },
        },
        mime,
        input.sizeBytes,
      );
      await valid.service
        .from('photo_job_files')
        .update({ status: 'uploading' })
        .eq('id', file.id)
        .eq('status', 'pending');
    } catch (cause) {
      await valid.service
        .from('photo_job_files')
        .update({ status: 'failed' })
        .eq('id', file.id)
        .eq('status', 'pending');
      throw cause;
    }
    await valid.service
      .from('photo_jobs')
      .update({ file_intake_status: 'receiving' })
      .eq('business_id', valid.link.business_id)
      .eq('id', valid.link.photo_job_id);
    return json({ uploadId: file.id, uploadUrl, chunkSize: 8 * 1024 * 1024 });
  } catch (cause) {
    if (cause instanceof Response) return cause;
    return errorResponse(cause);
  }
});
