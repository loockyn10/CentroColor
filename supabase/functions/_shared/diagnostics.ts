type PostgrestErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export function safeDatabaseError(error: unknown) {
  const value = (error ?? {}) as PostgrestErrorLike;
  return {
    code: value.code ?? 'unknown',
    message: value.message ?? 'Unknown database error',
    details: value.details ?? null,
    hint: value.hint ?? null,
  };
}

export function oauthRequestId() {
  return crypto.randomUUID();
}
