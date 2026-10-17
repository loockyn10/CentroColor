import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

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
  const service = serviceClient();
  const { data: membership } = await service
    .from('business_memberships')
    .select('role')
    .eq('business_id', businessId)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (!membership || !['owner', 'admin'].includes(membership.role))
    throw new Error('Se requiere rol owner o admin.');
  return { user, service };
}
