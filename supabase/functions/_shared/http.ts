export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(
  cause: unknown,
  fallback = 'No se pudo completar la operación.',
) {
  const message = cause instanceof Error ? cause.message : fallback;
  const explicitStatus =
    typeof cause === 'object' &&
    cause !== null &&
    'status' in cause &&
    typeof cause.status === 'number'
      ? cause.status
      : null;
  const status =
    explicitStatus ??
    (/inválido|expiró|revocado|cerrado|autoriz/i.test(message) ? 403 : 400);
  return json({ error: message }, status);
}

export async function body<T>(request: Request): Promise<T> {
  if (request.method === 'OPTIONS')
    throw new Response('ok', { headers: corsHeaders });
  return (await request.json()) as T;
}
