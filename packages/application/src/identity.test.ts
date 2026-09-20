import { describe, expect, it } from 'vitest';
import type { Business, Branch, Device } from '@centrocolor/domain';
import { resolveAppContext } from './identity';

const stamp = '2026-09-19T00:00:00.000Z';
const business: Business = {
  id: 'b',
  name: 'CentroColor',
  slug: 'centrocolor',
  createdAt: stamp,
  updatedAt: stamp,
};
const branch: Branch = {
  id: 'r',
  businessId: 'b',
  name: 'Sucursal principal',
  isActive: true,
  createdAt: stamp,
  updatedAt: stamp,
};
const device: Device = {
  id: 'd',
  businessId: 'b',
  branchId: 'r',
  name: 'Desktop',
  deviceType: 'desktop',
  installationId: 'i',
  isActive: true,
  lastSeenAt: null,
  createdAt: stamp,
  updatedAt: stamp,
};

function repositories(currentBranch: Branch) {
  return {
    businesses: { findById: async () => business },
    branches: { findById: async () => currentBranch },
    devices: { findById: async () => device },
  };
}

describe('resolveAppContext', () => {
  it('returns the coherent business, branch and device identifiers', async () => {
    await expect(
      resolveAppContext(
        { businessId: 'b', branchId: 'r', deviceId: 'd' },
        repositories(branch),
      ),
    ).resolves.toEqual({
      businessId: 'b',
      branchId: 'r',
      deviceId: 'd',
      installationId: 'i',
    });
  });

  it('rejects a branch from another business', async () => {
    await expect(
      resolveAppContext(
        { businessId: 'b', branchId: 'r', deviceId: 'd' },
        repositories({ ...branch, businessId: 'other' }),
      ),
    ).rejects.toThrow('mismatched relationships');
  });
});
