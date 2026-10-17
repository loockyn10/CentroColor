import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { assertBusinessAdmin } from './authorization.ts';

export const serviceClient = () =>
  createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

export async function requireAdmin(request: Request, businessId: string) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) throw new Error('Autorización requerida.');
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
  if (error || !user) throw new Error('Autorización inválida.');
  const { data: membership, error: membershipError } = await client
    .from('business_memberships')
    .select('business_id,user_id,role,is_active')
    .eq('business_id', businessId)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (membershipError)
    throw new Error('No se pudo validar la membresía del Business.');
  assertBusinessAdmin(user.id, businessId, membership);
  return { user, membership, service: serviceClient() };
}
