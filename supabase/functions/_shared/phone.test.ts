import { describe, expect, it } from 'vitest';
import { normalizeWhatsAppNumber, toCloudApiRecipient } from './phone';

describe('normalizeWhatsAppNumber', () => {
  it.each([
    '342 555 1234',
    '3425551234',
    '(342) 555-1234',
    '0342 15 555 1234',
    '0342 155551234',
    '+54 9 342 555 1234',
    '+5493425551234',
    '5493425551234',
    '+54 342 555 1234',
    '00 54 9 342 555 1234',
  ])('canonicaliza %s al mismo E.164 argentino con el 9 de celular', (text) => {
    expect(normalizeWhatsAppNumber(text)).toEqual({
      e164: '+5493425551234',
      display: '+54 9 342 555 1234',
    });
  });

  it('normaliza un celular de Buenos Aires', () => {
    expect(normalizeWhatsAppNumber('11 5555-1234')?.e164).toBe(
      '+5491155551234',
    );
    expect(normalizeWhatsAppNumber('011 15 5555 1234')?.e164).toBe(
      '+5491155551234',
    );
  });

  it('acepta números internacionales válidos', () => {
    expect(normalizeWhatsAppNumber('+44 7911 123456')?.e164).toBe(
      '+447911123456',
    );
    expect(normalizeWhatsAppNumber('+598 99 123 456')?.e164).toBe(
      '+59899123456',
    );
  });

  it.each([
    '',
    '   ',
    '123',
    'abc',
    '342 555 12',
    '0000000000',
    '+54 9 342 555 12345',
    'llamame al 3425551234',
    '342-555-1234 ext 5',
    '+1 23',
    '3425551234'.repeat(5),
  ])('rechaza %j', (text) => {
    expect(normalizeWhatsAppNumber(text)).toBeNull();
  });

  it('rechaza valores que no son texto', () => {
    expect(normalizeWhatsAppNumber(null)).toBeNull();
    expect(normalizeWhatsAppNumber(3425551234)).toBeNull();
    expect(normalizeWhatsAppNumber({})).toBeNull();
  });

  it('nunca genera un E.164 que no cumpla la restricción SQL', () => {
    for (const text of ['342 555 1234', '+44 7911 123456', '11 5555-1234'])
      expect(normalizeWhatsAppNumber(text)!.e164).toMatch(
        /^\+[1-9][0-9]{7,14}$/,
      );
  });
});

describe('toCloudApiRecipient', () => {
  it('manda sólo dígitos', () => {
    expect(toCloudApiRecipient('+5493425551234')).toBe('5493425551234');
  });
  it('permite quitar el 9 móvil argentino (quirk documentado de Meta)', () => {
    expect(toCloudApiRecipient('+5493425551234', true)).toBe('543425551234');
    expect(toCloudApiRecipient('+447911123456', true)).toBe('447911123456');
  });
});
