import { ApiError } from './http.ts';
import type { PhotoIntakeStore, UploadLinkRow } from './store.ts';
import { sha256Hex, uploadLinkError } from './upload-policy.ts';

export const sha256 = sha256Hex;

/** 32 random bytes by default, base64url without padding (43 characters). */
export function randomToken(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export async function destinationId(
  signingSecret: string,
  linkId: string,
  itemId: string,
) {
  return (await sha256Hex(`${signingSecret}:${linkId}:${itemId}`)).slice(0, 32);
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/**
 * The public token is a capability: it resolves (via its SHA-256) to exactly one
 * upload link, which is bound to one Business and one PhotoJob. Nothing else the
 * caller sends is trusted for authorization.
 */
export async function validateUploadToken(
  store: PhotoIntakeStore,
  token: unknown,
  options: { allowSubmitted?: boolean; now?: number } = {},
): Promise<{ link: UploadLinkRow }> {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token))
    throw new ApiError('Link inválido.', 404, 'link_invalid');
  const link = await store.getLinkByHash(await sha256Hex(token));
  if (!link) throw new ApiError('Link inválido.', 404, 'link_invalid');
  const problem = uploadLinkError(
    link,
    options.now ?? Date.now(),
    options.allowSubmitted ?? false,
  );
  if (problem)
    throw new ApiError(problem.message, problem.status, problem.code);
  return { link };
}
