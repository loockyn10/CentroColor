import { expect, it } from 'vitest';
import { getStorageHealth } from './index';

it('delegates storage health to the selected adapter', async () => {
  await expect(getStorageHealth({ check: async () => 'ready' })).resolves.toBe(
    'ready',
  );
});
