// Transport of the public order screens: anonymous Edge Function calls (the capability token
// is the only credential) and the upload choreography on top of the Sprint 13 portal client.
import {
  call,
  finalizeBody,
  sessionBody,
  submitBody,
  uploadChunks,
  type UploadSession,
} from '../photo-upload-client';
import type { CatalogService, OrderLine } from './model';

export type Catalog = {
  businessName: string;
  available: boolean;
  services: CatalogService[];
};

export type StartedOrder = {
  orderCode: string;
  uploadToken: string;
  customerFirstName: string;
  totalCents: number;
  destinations: {
    serviceId: string;
    destinationId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }[];
  expiresAt: string;
};

export type SubmittedOrder = {
  orderCode: string;
  status: 'received';
  alreadySubmitted: boolean;
  items: { name: string; quantity: number; totalCents: number }[];
  totalCents: number;
  trackingToken: string;
};

export type TrackedOrder = {
  businessName: string;
  orderCode: string;
  createdAt: string;
  status: 'received' | 'in_progress' | 'ready' | 'delivered' | 'cancelled';
  items: { name: string; quantity: number; totalCents: number }[];
  totalCents: number;
};

/** An error whose message is safe to show, plus the server code when there is one. */
export class PublicOrderError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

async function request<T>(name: string, body: unknown): Promise<T> {
  try {
    return await call<T>(name, body);
  } catch (cause) {
    const code = (cause as { code?: string } | null)?.code ?? null;
    throw new PublicOrderError(
      cause instanceof Error
        ? cause.message
        : 'No se pudo completar la operación.',
      code,
    );
  }
}

export const fetchCatalog = () => request<Catalog>('public-photo-catalog', {});
export const startOrder = (body: unknown) =>
  request<StartedOrder>('public-photo-order-start', body);
export const submitOrder = (token: string) =>
  request<SubmittedOrder>('public-photo-order-submit', { token });
export const trackOrder = (token: string) =>
  request<TrackedOrder>('public-photo-order-track', { token });

/* ───────────────────────────── uploading ───────────────────────────── */

export type UploadDeps = {
  call: typeof call;
  uploadChunks: typeof uploadChunks;
};
const realDeps: UploadDeps = { call, uploadChunks };

export type UploadTarget = {
  id: string;
  file: File;
  copies: number;
  destinationId: string;
};

/**
 * One photo: open the resumable session, send the bytes straight to storage and confirm.
 * A failed attempt is retried with a fresh session (the previous one is marked failed by the
 * server); the customer only sees an error after the retries are spent.
 */
export async function uploadPhoto(
  token: string,
  target: UploadTarget,
  onProgress: (percent: number) => void,
  options: { attempts?: number; deps?: UploadDeps } = {},
) {
  const deps = options.deps ?? realDeps;
  const attempts = options.attempts ?? 3;
  let previousUploadId: string | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      onProgress(0);
      const session = await deps.call<UploadSession>(
        'photo-upload-session',
        sessionBody(
          token,
          target.destinationId,
          target.file,
          target.copies,
          previousUploadId,
        ),
      );
      previousUploadId = session.uploadId;
      await deps.uploadChunks(
        target.file,
        session.uploadUrl,
        session.chunkSize,
        onProgress,
      );
      await deps.call(
        'photo-upload-finalize',
        finalizeBody(token, session.uploadId),
      );
      onProgress(100);
      return;
    } catch (cause) {
      lastError = cause;
      const code = (cause as { code?: string } | null)?.code;
      // Link problems cannot be fixed by trying again.
      if (
        code &&
        ['link_revoked', 'link_expired', 'link_submitted'].includes(code)
      )
        break;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('No se pudo subir la foto.');
}

/** Runs `work` over `items` with at most `limit` in flight; never rejects, returns the failures. */
export async function runPool<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
) {
  const failures: { item: T; error: unknown }[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await work(item);
      } catch (error) {
        failures.push({ item, error });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return failures;
}

export const lineSummary = (lines: OrderLine[]) =>
  lines.map((line) => ({
    name: line.service.name,
    copies: line.copies,
    totalCents: line.totalCents,
  }));

export { submitBody };
