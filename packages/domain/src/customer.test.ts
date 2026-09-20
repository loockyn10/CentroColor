import { describe, expect, it } from 'vitest';
import { normalizeCustomerDetails } from './customer';

describe('customer details', () => {
  it('normalizes optional fields without assuming a country code', () => {
    expect(
      normalizeCustomerDetails({
        fullName: '  Ana   Pérez  ',
        phone: ' +54  11 1234 5678 ',
        email: ' ANA@EXAMPLE.COM ',
        documentNumber: ' 123 ',
        notes: ' nota ',
      }),
    ).toEqual({
      fullName: 'Ana Pérez',
      phone: '+54 11 1234 5678',
      email: 'ana@example.com',
      documentNumber: '123',
      notes: 'nota',
    });
  });

  it('requires a name and validates entered email', () => {
    expect(() =>
      normalizeCustomerDetails({
        fullName: '  ',
        phone: null,
        email: null,
        documentNumber: null,
        notes: null,
      }),
    ).toThrow('nombre completo');
    expect(() =>
      normalizeCustomerDetails({
        fullName: 'Ana',
        phone: null,
        email: 'invalid',
        documentNumber: null,
        notes: null,
      }),
    ).toThrow('email válido');
  });
});
