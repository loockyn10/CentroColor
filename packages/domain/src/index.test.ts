import { describe, expect, it } from 'vitest';
import { requireId } from './index';

describe('requireId', () => {
  it('normalizes a non-empty identifier', () => {
    expect(requireId('  device-1  ')).toBe('device-1');
  });

  it('rejects an empty identifier', () => {
    expect(() => requireId('  ')).toThrow('An identifier is required');
  });
});
