// The upload choreography of an order, shared by /imprimir and /profesionales: send the photos
// with a bounded number in flight and send the confirmation with what the browser believes
// arrived. Prices and permissions are never decided here; this only moves bytes and counts.
import { runPool, uploadPhoto, type SubmitOptions } from './client';
import type { PhotoEntry } from './model';
import { orderedUploadIds } from './order-blocks';

export type UploadProgress = {
  status: 'waiting' | 'uploading' | 'done' | 'failed';
  percent: number;
  error?: string;
};

export const messageFor = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : 'No se pudo completar la operación. Reintentá.';

export const errorCode = (error: unknown) =>
  (error as { code?: string | null } | null)?.code ?? null;

/** The order the server refused to confirm because a size lost photos. */
export const isIncompleteOrder = (error: unknown) =>
  errorCode(error) === 'order_incomplete';

type StartedForUpload = {
  uploadToken: string;
  destinations: { serviceId: string; destinationId: string }[];
};

/**
 * Uploads `entries` (all of them, or only the failed ones on a retry). Each photo's last attempt
 * is remembered in `attempts`, so a retry names it and the server never stores a photo twice.
 * Never rejects: returns how many photos still failed.
 */
export async function sendEntries(args: {
  started: StartedForUpload;
  entries: PhotoEntry[];
  attempts: Map<string, string>;
  concurrency: number;
  onProgress: (id: string, progress: UploadProgress) => void;
  upload?: typeof uploadPhoto;
}) {
  const { started, entries, attempts, onProgress } = args;
  const upload = args.upload ?? uploadPhoto;
  const destinations = new Map(
    started.destinations.map((x) => [x.serviceId, x.destinationId]),
  );
  const failures = await runPool(entries, args.concurrency, async (entry) => {
    onProgress(entry.id, { status: 'uploading', percent: 0 });
    try {
      await upload(
        started.uploadToken,
        {
          id: entry.id,
          file: entry.file,
          copies: entry.copies,
          destinationId: destinations.get(entry.serviceId)!,
          previousUploadId: attempts.get(entry.id),
        },
        (percent) => onProgress(entry.id, { status: 'uploading', percent }),
        { onAttempt: (uploadId) => attempts.set(entry.id, uploadId) },
      );
      onProgress(entry.id, { status: 'done', percent: 100 });
    } catch (error) {
      onProgress(entry.id, {
        status: 'failed',
        percent: 0,
        error: messageFor(error),
      });
      throw error;
    }
  });
  return failures.length;
}

/**
 * What the confirmation tells the server: how many photos each size should have received, the
 * uploads that make up the order (in display order, so the server numbers the files and retires
 * anything else) and whether the customer chose to send it without the photos that failed.
 */
export function buildSubmitOptions(args: {
  started: StartedForUpload;
  selected: string[];
  sent: PhotoEntry[];
  attempts: Map<string, string>;
  acceptPartial?: boolean;
}): SubmitOptions {
  const expectedFiles: Record<string, number> = {};
  for (const destination of args.started.destinations)
    expectedFiles[destination.destinationId] = args.sent.filter(
      (x) => x.serviceId === destination.serviceId,
    ).length;
  const uploadIds = orderedUploadIds(args.selected, args.sent, args.attempts);
  return {
    expectedFiles,
    ...(uploadIds ? { uploadIds } : {}),
    ...(args.acceptPartial ? { acceptPartial: true } : {}),
  };
}
