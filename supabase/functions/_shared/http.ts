import { DatabaseError, consoleLogger, type Logger } from './diagnostics.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export const GENERIC_ERROR_MESSAGE = 'No se pudo completar la operación.';

/**
 * A failure whose message is written for the end user and is safe to return.
 * Anything that is not an ApiError (or another error carrying an explicit numeric
 * `status`) is treated as internal: it is logged server-side and the client only
 * receives a generic message plus a request id to correlate with the logs.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'bad_request',
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function preflight() {
  return new Response('ok', { headers: corsHeaders });
}

type ErrorOptions = { requestId?: string; logger?: Logger; context?: string };

function explicitStatus(cause: unknown) {
  return typeof cause === 'object' &&
    cause !== null &&
    'status' in cause &&
    typeof cause.status === 'number'
    ? cause.status
    : null;
}

export function errorResponse(cause: unknown, options: ErrorOptions = {}) {
  const {
    requestId,
    logger = consoleLogger,
    context = 'edge_function',
  } = options;
  const status = explicitStatus(cause);
  if (cause instanceof Error && status !== null && status < 500) {
    const code =
      'code' in cause && typeof cause.code === 'string'
        ? cause.code
        : undefined;
    return json({ error: cause.message, code, requestId }, status);
  }
  if (cause instanceof Error && status !== null) {
    // Curated 5xx (configuration, Google, Drive): message is user-safe, still logged.
    const code =
      'code' in cause && typeof cause.code === 'string'
        ? cause.code
        : undefined;
    logger('error', `${context}_failed`, {
      requestId,
      status,
      code,
      message: cause.message,
    });
    return json({ error: cause.message, code, requestId }, status);
  }
  if (cause instanceof DatabaseError) {
    logger('error', `${context}_database_error`, {
      requestId,
      operation: cause.operation,
      databaseError: cause.detail,
    });
    return json(
      { error: GENERIC_ERROR_MESSAGE, code: 'database_error', requestId },
      500,
    );
  }
  logger('error', `${context}_unexpected_error`, {
    requestId,
    name: cause instanceof Error ? cause.name : typeof cause,
    message: cause instanceof Error ? cause.message : String(cause),
  });
  return json(
    { error: GENERIC_ERROR_MESSAGE, code: 'internal_error', requestId },
    500,
  );
}

export async function body<T>(request: Request): Promise<T> {
  try {
    const value: unknown = await request.json();
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('not an object');
    return value as T;
  } catch {
    throw new ApiError('La solicitud no es válida.', 400, 'invalid_request');
  }
}
