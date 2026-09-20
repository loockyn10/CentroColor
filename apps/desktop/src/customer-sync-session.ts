import type { SupabaseClient } from '@supabase/supabase-js';
import {
  syncCustomers,
  type BusinessContext,
  type CustomerSyncResult,
} from '@centrocolor/application';
import { CloudCustomerSyncAdapter } from './cloud-customer-sync-adapter';
import { SQLiteCustomerSyncAdapter } from './sqlite-customer-sync-adapter';

export async function syncAuthenticatedCustomers(
  context: BusinessContext,
  client: SupabaseClient,
  local: SQLiteCustomerSyncAdapter,
): Promise<CustomerSyncResult> {
  await validateCloudBusinessContext(context, client);
  return syncCustomers(
    context.businessId,
    local,
    new CloudCustomerSyncAdapter(client),
  );
}

export async function validateCloudBusinessContext(
  context: BusinessContext,
  client: SupabaseClient,
): Promise<void> {
  const { data, error } = await client.auth.getUser();
  if (error) {
    if (error.status === 401 || error.name === 'AuthSessionMissingError')
      throw new Error('La sesión Cloud requiere revalidación.');
    throw error;
  }
  if (data.user?.id !== context.userId)
    throw new Error('La sesión Cloud requiere revalidación.');
  const membership = await client
    .from('business_memberships')
    .select('id')
    .eq('user_id', context.userId)
    .eq('business_id', context.businessId)
    .eq('is_active', true)
    .maybeSingle();
  if (membership.error) throw membership.error;
  if (!membership.data)
    throw new Error('No hay acceso Cloud activo para este negocio.');
}
