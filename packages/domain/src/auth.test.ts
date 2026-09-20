import { describe, expect, it } from 'vitest';
import { businessRoles, parseBusinessRole } from './auth';

describe('business roles', () => {
  it('accepts only the initial roles', () => {
    expect(businessRoles.map(parseBusinessRole)).toEqual([
      'owner',
      'admin',
      'staff',
    ]);
    expect(() => parseBusinessRole('superuser')).toThrow(
      'Invalid business role',
    );
  });
});
