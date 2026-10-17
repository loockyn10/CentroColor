// Transport for the public upload portal: Edge Function calls and the Google Drive
// resumable protocol. No React and no Supabase session: the link token is the capability.

export type UploadDestination = {
  destinationId: string;
  name: string;
  quantity: number;
  widthMm: number | null;
  heightMm: number | null;
  workflowRoute: 'lab' | 'editing' | 'other';
};
export type UploadContext = {
  businessName: string;
  customerName: string;
  orderCode: string;
  destinations: UploadDestination[];
  expiresAt: string | null;
};
export type UploadSession = {
  uploadId: string;
  uploadUrl: string;
  chunkSize: number;
};

/**
 * Request bodies, one builder per Edge Function. Their keys are the contract with
 * supabase/functions/_shared/upload-handlers.ts (Upload*Payload); a contract test
 * runs these through the real handlers.
 */
export const contextBody = (token: string) => ({ token });
export const sessionBody = (
  token: string,
  destinationId: string,
  file: { name: string; type: string; size: number },
  copies: number,
  previousUploadId?: string,
) => ({
  token,
  destinationId,
  filename: file.name,
  mimeType: file.type,
  sizeBytes: file.size,
  copies,
  previousUploadId,
});
export const finalizeBody = (token: string, uploadId: string) => ({
  token,
  uploadId,
});
export const submitBody = (token: string) => ({ token });

export const NETWORK_MESSAGE =
  'No se pudo contactar a CentroColor. Revisá tu conexión e intentá de nuevo.';
export const DRIVE_NETWORK_MESSAGE =
  'No se pudo enviar el archivo a Google Drive. Revisá tu conexión y reintentá.';

export async function call<T = unknown>(
  name: string,
  body: unknown,
): Promise<T> {
  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  let response: Response;
  try {
    response = await fetch(`${base}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key ?? '',
        Authorization: `Bearer ${key ?? ''}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(NETWORK_MESSAGE);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    // The server's code (e.g. `price_changed`, `link_expired`) lets callers react to it.
    const failure = new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'No se pudo contactar a CentroColor.',
    );
    throw Object.assign(failure, {
      code: typeof payload.code === 'string' ? payload.code : null,
      status: response.status,
    });
  }
  return payload as T;
}

const parseRange = (header: string | null) =>
  header ? Number(header.split('-')[1]) + 1 : null;

/** Asks Drive how many bytes of the session it already has. */
export async function resumableOffset(url: string, size: number) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes */${size}` },
  });
  if (response.ok) return size;
  if (response.status !== 308) throw new Error('La sesión de carga venció.');
  return parseRange(response.headers.get('Range')) ?? 0;
}

export type ChunkOptions = {
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * PUT chunks with `Content-Range`. Drive answers 308 (Resume Incomplete) for every
 * chunk but the last, and 200/201 for the final one. Network errors, 429 and 5xx are
 * retried a few times after asking Drive for the confirmed offset; anything else (for
 * example an expired session) is surfaced so the caller can open a new session.
 */
export async function uploadChunks(
  file: File,
  url: string,
  chunkSize: number,
  onProgress: (value: number) => void,
  start = 0,
  options: ChunkOptions = {},
) {
  const maxRetries = options.maxRetries ?? 3;
  const sleep = options.sleep ?? defaultSleep;
  let offset = start;
  let failures = 0;
  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    let response: Response | null = null;
    try {
      response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'Content-Range': `bytes ${offset}-${end - 1}/${file.size}`,
        },
        body: file.slice(offset, end),
      });
    } catch {
      response = null;
    }
    if (!response || response.status === 429 || response.status >= 500) {
      failures += 1;
      if (failures > maxRetries)
        throw new Error(
          response
            ? `La carga se interrumpió (${response.status}).`
            : DRIVE_NETWORK_MESSAGE,
        );
      await sleep(1000 * 2 ** (failures - 1));
      offset = await resumableOffset(url, file.size).catch(() => offset);
      onProgress(Math.round((offset * 100) / file.size));
      continue;
    }
    if (response.status !== 308 && !response.ok)
      throw new Error(`La carga se interrumpió (${response.status}).`);
    failures = 0;
    // Range may be hidden from the browser by CORS; the chunk was accepted in full then.
    offset = parseRange(response.headers.get('Range')) ?? end;
    onProgress(Math.round((offset * 100) / file.size));
  }
}
