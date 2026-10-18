import { describe, expect, it } from 'vitest';
import { whatsappNumber } from './customers';

describe('enlace de WhatsApp de la ficha de cliente', () => {
  it('arma el número para wa.me con código de país argentino', () => {
    expect(whatsappNumber('11 5555-1234')).toBe('5491155551234');
    expect(whatsappNumber('0342 555 1234')).toBe('5493425551234');
  });
  it('respeta un número que ya trae código de país y descarta lo que no es dígito', () => {
    expect(whatsappNumber('+54 9 11 5555-1234')).toBe('5491155551234');
    expect(whatsappNumber('abc')).toBeNull();
    expect(whatsappNumber('')).toBeNull();
  });
});
