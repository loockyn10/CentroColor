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

export const requestId = oauthRequestId;

/** A database failure with the operation that produced it. Never returned verbatim to clients. */
export class DatabaseError extends Error {
  readonly detail: ReturnType<typeof safeDatabaseError>;
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    const detail = safeDatabaseError(cause);
    super(`Database operation failed: ${operation} (${detail.code})`);
    this.detail = detail;
  }
}

export type Logger = (
  level: 'info' | 'warn' | 'error',
  event: string,
  data?: Record<string, unknown>,
) => void;

/** Structured server-side logging. Callers must never pass tokens, secrets or file contents. */
export const consoleLogger: Logger = (level, event, data = {}) => {
  console[level](event, data);
};
