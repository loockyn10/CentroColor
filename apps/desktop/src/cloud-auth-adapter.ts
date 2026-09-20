import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveBusinessContext,
  type AuthorizedIdentity,
  type BusinessContext,
} from '@centrocolor/application';
import {
  parseBusinessRole,
  type Branch,
  type Business,
  type BusinessMembership,
  type Profile,
} from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';

export async function loadCloudBusinessContext(
  userId: string,
  options: { requireBranch?: boolean } = {},
  client: SupabaseClient = getSupabaseClient(),
): Promise<BusinessContext | null> {
  const profileResult = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (profileResult.error) throw profileResult.error;
  const membershipResult = await client
    .from('business_memberships')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true);
  if (membershipResult.error) throw membershipResult.error;
  const memberships: BusinessMembership[] = (membershipResult.data ?? []).map(
    (row) => ({
      id: row.id,
      businessId: row.business_id,
      userId: row.user_id,
      role: parseBusinessRole(row.role),
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );
  if (memberships.length === 0) return null;
  const businessIds = memberships.map((m) => m.businessId);
  const [businessResult, branchResult] = await Promise.all([
    client.from('businesses').select('*').in('id', businessIds),
    client
      .from('branches')
      .select('*')
      .in('business_id', businessIds)
      .eq('is_active', true),
  ]);
  if (businessResult.error) throw businessResult.error;
  if (branchResult.error) throw branchResult.error;
  const profileRow = profileResult.data;
  const identity: AuthorizedIdentity = {
    profile: profileRow
      ? ({
          id: profileRow.id,
          displayName: profileRow.display_name,
          createdAt: profileRow.created_at,
          updatedAt: profileRow.updated_at,
        } satisfies Profile)
      : null,
    memberships,
    businesses: (businessResult.data ?? []).map((row): Business => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    branches: (branchResult.data ?? []).map((row): Branch => ({
      id: row.id,
      businessId: row.business_id,
      name: row.name,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
  return resolveBusinessContext(userId, identity, options);
}
