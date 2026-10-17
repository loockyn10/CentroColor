import { serviceClient } from './supabase.ts';
import { sha256Hex, uploadLinkError } from './upload-policy.ts';

export async function sha256(value: string) {
  return await sha256Hex(value);
}

export function randomToken(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export async function destinationId(linkId: string, itemId: string) {
  const secret = Deno.env.get('PHOTO_UPLOAD_SIGNING_SECRET');
  if (!secret) throw new Error('Falta PHOTO_UPLOAD_SIGNING_SECRET.');
  return (await sha256(`${secret}:${linkId}:${itemId}`)).slice(0, 32);
}

export async function validateUploadToken(
  token: string,
  allowSubmitted = false,
) {
  if (!token || token.length < 32) throw new Error('Link inválido.');
  const service = serviceClient();
  const hash = await sha256(token);
  const { data: link, error } = await service
    .from('photo_job_upload_links')
    .select('*')
    .eq('token_hash', hash)
    .maybeSingle();
  if (error || !link) throw new Error('Link inválido.');
  const linkError = uploadLinkError(link, Date.now(), allowSubmitted);
  if (linkError) throw new Error(linkError);
  return { service, link };
}
