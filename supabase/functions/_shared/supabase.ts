import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { assertBusinessAdmin } from './authorization.ts';
import { DatabaseError } from './diagnostics.ts';
import { ApiError } from './http.ts';

export const serviceClient = () =>
  createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

async function resolveMembership(request: Request, businessId: string) {
  const authorization = request.headers.get('Authorization');
  if (!authorization)
    throw new ApiError('Autorización requerida.', 401, 'unauthorized');
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    },
  );
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user)
    throw new ApiError('Autorización inválida.', 401, 'unauthorized');
  const { data: membership, error: membershipError } = await client
    .from('business_memberships')
    .select('business_id,user_id,role,is_active')
    .eq('business_id', businessId)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (membershipError)
    throw new DatabaseError('business_memberships.get', membershipError);
  return { user, membership };
}

/**
 * Admin authentication, in this order and nothing else before it:
 * 1. JWT from the caller (authenticated/RLS client, never the service role);
 * 2. auth user resolved from that JWT;
 * 3. active business_memberships row read under RLS;
 * 4. role must be owner/admin for the requested Business.
 * The service-role client is created by the caller only after this resolves.
 */
export async function authenticateAdmin(request: Request, businessId: string) {
  const { user, membership } = await resolveMembership(request, businessId);
  assertBusinessAdmin(user.id, businessId, membership);
  return { user, membership: membership! };
}

/** Same chain, but any active member (owner, admin or staff) of the Business is accepted. */
export async function authenticateMember(request: Request, businessId: string) {
  const { user, membership } = await resolveMembership(request, businessId);
  if (
    !membership ||
    !membership.is_active ||
    membership.business_id !== businessId
  )
    throw new ApiError('No tenés acceso a este negocio.', 403, 'forbidden');
  return { user, membership };
}

export async function requireAdmin(request: Request, businessId: string) {
  const { user, membership } = await authenticateAdmin(request, businessId);
  return { user, membership, service: serviceClient() };
}
