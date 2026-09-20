import { describe, expect, it } from 'vitest';
import type { AuthorizedIdentity } from './auth';
import { resolveBusinessContext } from './auth';

const stamp = '2026-09-20T00:00:00.000Z';
const identity: AuthorizedIdentity = {
  profile: { id: 'u', displayName: 'Ana', createdAt: stamp, updatedAt: stamp },
  memberships: [
    {
      id: 'm',
      businessId: 'b',
      userId: 'u',
      role: 'staff',
      isActive: true,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ],
  businesses: [
    {
      id: 'b',
      name: 'CentroColor',
      slug: 'centrocolor',
      createdAt: stamp,
      updatedAt: stamp,
    },
  ],
  branches: [
    {
      id: 'r',
      businessId: 'b',
      name: 'Principal',
      isActive: true,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ],
};

describe('resolveBusinessContext', () => {
  it('selects an active membership and a branch in its business', () => {
    expect(
      resolveBusinessContext('u', identity, {
        requireBranch: true,
        now: stamp,
      }),
    ).toMatchObject({
      userId: 'u',
      businessId: 'b',
      branchId: 'r',
      role: 'staff',
      authorization: 'cloud-validated',
    });
  });
  it('blocks a user with no active membership', () => {
    expect(
      resolveBusinessContext('u', { ...identity, memberships: [] }),
    ).toBeNull();
    expect(
      resolveBusinessContext('u', {
        ...identity,
        memberships: [{ ...identity.memberships[0], isActive: false }],
      }),
    ).toBeNull();
  });
  it('blocks a different user and a missing profile', () => {
    expect(resolveBusinessContext('other', identity)).toBeNull();
    expect(
      resolveBusinessContext('u', { ...identity, profile: null }),
    ).toBeNull();
  });
  it('requires an active branch for Desktop', () => {
    expect(
      resolveBusinessContext(
        'u',
        { ...identity, branches: [] },
        { requireBranch: true },
      ),
    ).toBeNull();
  });
  it('rejects a membership whose business is not available', () => {
    expect(
      resolveBusinessContext('u', { ...identity, businesses: [] }),
    ).toBeNull();
  });
  it('prefers the selected business when multiple memberships exist', () => {
    const another = { ...identity.businesses[0], id: 'c', name: 'Otro' };
    const membership = { ...identity.memberships[0], id: 'n', businessId: 'c' };
    expect(
      resolveBusinessContext(
        'u',
        {
          ...identity,
          businesses: [...identity.businesses, another],
          memberships: [...identity.memberships, membership],
        },
        { preferredBusinessId: 'c' },
      )?.businessId,
    ).toBe('c');
  });
});
