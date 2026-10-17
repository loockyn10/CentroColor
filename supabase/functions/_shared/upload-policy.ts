export type UploadLinkState = {
  revoked_at: string | null;
  expires_at: string | null;
  submitted_at: string | null;
};

export async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}

export type LinkProblem = { message: string; status: number; code: string };

export function uploadLinkError(
  link: UploadLinkState,
  now = Date.now(),
  allowSubmitted = false,
): LinkProblem | null {
  if (link.revoked_at)
    return {
      message: 'Este link fue revocado.',
      status: 410,
      code: 'link_revoked',
    };
  if (link.expires_at && Date.parse(link.expires_at) <= now)
    return { message: 'Este link expiró.', status: 410, code: 'link_expired' };
  if (link.submitted_at && !allowSubmitted)
    return {
      message: 'Este envío ya fue finalizado.',
      status: 409,
      code: 'link_submitted',
    };
  return null;
}

export const ALLOWED_EXTENSIONS = new Set([
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

export const MAX_FILES_PER_JOB = 500;
/** Sequential uploads of many small photos are legitimate; this only stops runaway clients. */
export const MAX_SESSIONS_PER_MINUTE = 120;
export const MAX_COPIES = 9999;

export function driveFileError(
  remote: {
    trashed?: boolean;
    parents?: string[];
    size?: string | number;
    name?: string;
  },
  expected: { folderId: string; sizeBytes: number; storedFilename?: string },
) {
  if (remote.trashed || !remote.parents?.includes(expected.folderId))
    return 'Drive no confirmó la carpeta esperada.';
  if (Number(remote.size) !== expected.sizeBytes)
    return 'Drive no confirmó el tamaño completo del archivo.';
  if (expected.storedFilename && remote.name !== expected.storedFilename)
    return 'Drive no confirmó el nombre esperado del archivo.';
  return null;
}
