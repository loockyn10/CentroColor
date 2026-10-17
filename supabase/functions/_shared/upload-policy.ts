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

export function uploadLinkError(
  link: UploadLinkState,
  now = Date.now(),
  allowSubmitted = false,
) {
  if (link.revoked_at) return 'Este link fue revocado.';
  if (link.expires_at && Date.parse(link.expires_at) <= now)
    return 'Este link expiró.';
  if (link.submitted_at && !allowSubmitted)
    return 'Este envío ya fue finalizado.';
  return null;
}

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
