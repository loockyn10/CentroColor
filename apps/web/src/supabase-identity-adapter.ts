import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BusinessRepository,
  BranchRepository,
  DeviceRepository,
} from '@centrocolor/application';
import {
  parseDeviceType,
  type Business,
  type Branch,
  type Device,
} from '@centrocolor/domain';
import { getSupabaseClient } from './cloud-config';

type BusinessRow = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
};
type BranchRow = {
  id: string;
  business_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
type DeviceRow = {
  id: string;
  business_id: string;
  branch_id: string;
  name: string;
  device_type: string;
  installation_id: string;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

function requireAuthorized(
  error: { code?: string; message: string } | null,
): void {
  if (!error) return;
  if (error.code === '42501') {
    throw new Error(
      'El acceso a identidades Cloud requiere autenticación y políticas RLS futuras',
    );
  }
  throw new Error(`No se pudo consultar la identidad Cloud: ${error.message}`);
}

/** Read-only adapter until authentication and tenant-scoped RLS are implemented. */
export function createSupabaseIdentityRepositories(
  client: SupabaseClient = getSupabaseClient(),
): {
  businesses: BusinessRepository;
  branches: BranchRepository;
  devices: DeviceRepository;
} {
  return {
    businesses: {
      async findById(id): Promise<Business | null> {
        const { data, error } = await client
          .from('businesses')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        requireAuthorized(error);
        const row = data as BusinessRow | null;
        return (
          row && {
            id: row.id,
            name: row.name,
            slug: row.slug,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        );
      },
    },
    branches: {
      async findById(id): Promise<Branch | null> {
        const { data, error } = await client
          .from('branches')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        requireAuthorized(error);
        const row = data as BranchRow | null;
        return (
          row && {
            id: row.id,
            businessId: row.business_id,
            name: row.name,
            isActive: row.is_active,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        );
      },
    },
    devices: {
      async findById(id): Promise<Device | null> {
        const { data, error } = await client
          .from('devices')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        requireAuthorized(error);
        const row = data as DeviceRow | null;
        return (
          row && {
            id: row.id,
            businessId: row.business_id,
            branchId: row.branch_id,
            name: row.name,
            deviceType: parseDeviceType(row.device_type),
            installationId: row.installation_id,
            isActive: row.is_active,
            lastSeenAt: row.last_seen_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        );
      },
    },
  };
}

export async function checkSupabaseConnection(): Promise<
  'reachable' | 'authorization_pending' | 'unavailable'
> {
  const client = getSupabaseClient();
  const { error } = await client
    .from('businesses')
    .select('id', { head: true, count: 'exact' })
    .limit(0);
  if (!error) return 'reachable';
  if (error.code === '42501') return 'authorization_pending';
  return 'unavailable';
}
