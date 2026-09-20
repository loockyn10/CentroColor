import type {
  Branch,
  Business,
  BusinessMembership,
  BusinessRole,
  Profile,
} from '@centrocolor/domain';

export interface BusinessContext {
  userId: string;
  profile: Pick<Profile, 'id' | 'displayName'>;
  businessId: string;
  businessName: string;
  branchId: string | null;
  branchName: string | null;
  deviceId: string | null;
  role: BusinessRole;
  authorization: 'cloud-validated' | 'offline-authenticated';
  lastCloudValidationAt: string;
}

export interface AuthorizedIdentity {
  profile: Profile | null;
  memberships: BusinessMembership[];
  businesses: Business[];
  branches: Branch[];
}

export function resolveBusinessContext(
  userId: string,
  identity: AuthorizedIdentity,
  options: {
    requireBranch?: boolean;
    preferredBusinessId?: string;
    now?: string;
  } = {},
): BusinessContext | null {
  const { profile, memberships, businesses, branches } = identity;
  if (!profile || profile.id !== userId) return null;
  const eligible = memberships
    .filter((m) => m.userId === userId && m.isActive)
    .sort((a, b) => a.businessId.localeCompare(b.businessId));
  const ordered = options.preferredBusinessId
    ? [
        ...eligible.filter((m) => m.businessId === options.preferredBusinessId),
        ...eligible.filter((m) => m.businessId !== options.preferredBusinessId),
      ]
    : eligible;
  for (const membership of ordered) {
    const business = businesses.find((b) => b.id === membership.businessId);
    if (!business) continue;
    const branch = branches
      .filter((b) => b.businessId === business.id && b.isActive)
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    if (options.requireBranch && !branch) continue;
    return {
      userId,
      profile: { id: profile.id, displayName: profile.displayName },
      businessId: business.id,
      businessName: business.name,
      branchId: branch?.id ?? null,
      branchName: branch?.name ?? null,
      deviceId: null,
      role: membership.role,
      authorization: 'cloud-validated',
      lastCloudValidationAt: options.now ?? new Date().toISOString(),
    };
  }
  return null;
}
