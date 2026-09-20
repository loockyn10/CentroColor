export const businessRoles = ['owner', 'admin', 'staff'] as const;
export type BusinessRole = (typeof businessRoles)[number];

export function parseBusinessRole(value: string): BusinessRole {
  if (businessRoles.some((role) => role === value))
    return value as BusinessRole;
  throw new Error(`Invalid business role: ${value}`);
}

export interface Profile {
  id: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessMembership {
  id: string;
  businessId: string;
  userId: string;
  role: BusinessRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
