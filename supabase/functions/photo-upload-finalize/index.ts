import { corsHeaders, body, errorResponse, json } from '../_shared/http.ts';
import { accessForBusiness, driveFile } from '../_shared/google-drive.ts';
import { validateUploadToken } from '../_shared/token.ts';
import { driveFileError } from '../_shared/upload-policy.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });
  try {
    const { token, uploadId } = await body<{ token: string; uploadId: string }>(
      request,
    );
    const valid = await validateUploadToken(token);
    const { data: file } = await valid.service
      .from('photo_job_files')
      .select('*')
      .eq('id', uploadId)
      .eq('business_id', valid.link.business_id)
      .eq('photo_job_id', valid.link.photo_job_id)
      .maybeSingle();
    if (!file) throw new Error('La carga no pertenece a este pedido.');
    if (file.status === 'uploaded')
      return json({ ok: true, uploadedAt: file.uploaded_at });
    const google = await accessForBusiness(valid.link.business_id);
    const remote = await driveFile(google.token, file.drive_file_id);
    const verificationError = driveFileError(remote, {
      folderId: file.drive_folder_id,
      sizeBytes: Number(file.size_bytes),
      storedFilename: file.stored_filename,
    });
    if (verificationError) throw new Error(verificationError);
    const uploadedAt = new Date().toISOString();
    await valid.service
      .from('photo_job_files')
      .update({
        status: 'uploaded',
        mime_type: remote.mimeType ?? file.mime_type,
        uploaded_at: uploadedAt,
      })
      .eq('id', file.id)
      .eq('status', 'uploading');
    return json({ ok: true, uploadedAt });
  } catch (cause) {
    if (cause instanceof Response) return cause;
    return errorResponse(cause);
  }
});
