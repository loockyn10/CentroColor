import { describe, expect, it } from 'vitest';
import { parseDeviceType } from './identity';

describe('parseDeviceType', () => {
  it.each(['desktop', 'web', 'mobile'])("accepts '%s'", (value) => {
    expect(parseDeviceType(value)).toBe(value);
  });

  it('rejects an unsupported type', () => {
    expect(() => parseDeviceType('tablet')).toThrow('Unsupported device type');
  });
});
