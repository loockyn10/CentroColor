export type BusinessMembershipAuthorization = {
  business_id: string;
  user_id: string;
  role: string;
  is_active: boolean;
};

export class AuthorizationError extends Error {
  readonly status = 403;
}

export function assertBusinessAdmin(
  authenticatedUserId: string,
  requestedBusinessId: string,
  membership: BusinessMembershipAuthorization | null,
) {
  if (
    !membership ||
    membership.user_id !== authenticatedUserId ||
    membership.business_id !== requestedBusinessId ||
    !membership.is_active ||
    (membership.role !== 'owner' && membership.role !== 'admin')
  )
    throw new AuthorizationError('Se requiere rol owner o admin.');

  return membership;
}
