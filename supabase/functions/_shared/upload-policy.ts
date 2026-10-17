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
/**
 * Anonymous self-service orders are held to tighter limits than staff-issued links: only the
 * photo formats phones and cameras produce (no RAW), 100 MiB per file and 200 files per order,
 * so an unauthenticated visitor cannot fill the shop's Drive.
 */
export const PUBLIC_ORDER_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'heic',
  'heif',
  'tif',
  'tiff',
]);
export const PUBLIC_ORDER_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const PUBLIC_ORDER_MAX_FILES = 200;
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
    return 'No pudimos confirmar la carpeta de destino de la foto. Reintentá.';
  if (Number(remote.size) !== expected.sizeBytes)
    return 'No pudimos confirmar el tamaño completo de la foto. Reintentá.';
  if (expected.storedFilename && remote.name !== expected.storedFilename)
    return 'No pudimos confirmar el nombre de la foto. Reintentá.';
  return null;
}
