/* eslint-disable @typescript-eslint/no-explicit-any -- supabase-js error/body boundary. */

/** Error shown to the user: `message` is already safe and written in Spanish. */
export class EdgeFunctionError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly code: string | null = null,
    readonly requestId: string | null = null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'EdgeFunctionError';
  }
}

type InvokeClient = {
  functions: {
    invoke(
      name: string,
      options: { body: Record<string, unknown> },
    ): Promise<{ data: any; error: any }>;
  };
};

async function readBody(context: unknown) {
  const response = context as Partial<Response> | undefined;
  if (!response || typeof response.clone !== 'function') return null;
  try {
    const text = await response.clone!().text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return text ? { message: text.slice(0, 200) } : null;
    }
  } catch {
    return null;
  }
}

const withDetail = (failure: string, detail: string | null) =>
  detail ? `${failure}: ${detail}` : `${failure}.`;

/**
 * Turns whatever supabase-js throws for a failed Edge Function call into an
 * EdgeFunctionError. `FunctionsHttpError` only says "non-2xx status code"; the useful
 * explanation is the JSON body returned by the function, which lives in `error.context`.
 */
export async function toEdgeFunctionError(
  error: unknown,
  failure: string,
): Promise<EdgeFunctionError> {
  if (error instanceof EdgeFunctionError) return error;
  const name = (error as { name?: string } | null)?.name;
  if (name === 'FunctionsHttpError') {
    const context = (error as { context?: unknown }).context;
    const status =
      typeof (context as { status?: unknown })?.status === 'number'
        ? ((context as { status: number }).status as number)
        : null;
    const payload = await readBody(context);
    const serverMessage =
      typeof payload?.error === 'string'
        ? payload.error
        : typeof payload?.message === 'string'
          ? payload.message
          : null;
    const code = typeof payload?.code === 'string' ? payload.code : null;
    const requestId =
      typeof payload?.requestId === 'string' ? payload.requestId : null;
    let detail = serverMessage;
    if (status === 401) detail = 'tu sesión venció. Volvé a iniciar sesión.';
    else if (!detail && status === 403)
      detail = 'no tenés permisos para esta acción.';
    else if (!detail && status !== null && status >= 500)
      detail = 'error interno del servidor.';
    if (status !== null && status >= 500 && requestId)
      detail = `${detail ?? 'error interno del servidor.'} (ref. ${requestId.slice(0, 8)})`;
    return new EdgeFunctionError(
      withDetail(failure, detail),
      status,
      code,
      requestId,
      { cause: error },
    );
  }
  if (name === 'FunctionsRelayError')
    return new EdgeFunctionError(
      withDetail(
        failure,
        'el servicio no está disponible. Reintentá en unos minutos.',
      ),
      null,
      null,
      null,
      { cause: error },
    );
  if (name === 'FunctionsFetchError')
    return new EdgeFunctionError(
      withDetail(
        failure,
        'no se pudo contactar con CentroColor. Revisá tu conexión.',
      ),
      null,
      null,
      null,
      { cause: error },
    );
  return new EdgeFunctionError(withDetail(failure, null), null, null, null, {
    cause: error,
  });
}

/** Single entry point for authenticated Edge Function calls from the Web app. */
export async function invokeEdgeFunction<T = any>(
  client: InvokeClient,
  name: string,
  body: Record<string, unknown>,
  failure: string,
): Promise<T> {
  let result: { data: any; error: any };
  try {
    result = await client.functions.invoke(name, { body });
  } catch (cause) {
    throw await toEdgeFunctionError(cause, failure);
  }
  if (result.error) throw await toEdgeFunctionError(result.error, failure);
  if (
    result.data &&
    typeof result.data === 'object' &&
    typeof result.data.error === 'string'
  )
    throw new EdgeFunctionError(
      withDetail(failure, result.data.error),
      null,
      typeof result.data.code === 'string' ? result.data.code : null,
    );
  return result.data as T;
}
