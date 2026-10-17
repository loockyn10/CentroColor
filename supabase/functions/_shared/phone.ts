// WhatsApp number normalization (server-side). The browser never decides the stored number.
//
// Deno resolves `npm:` specifiers natively (no import map to keep in sync). The Vitest
// config aliases this exact specifier to the `libphonenumber-js` package in node_modules, so
// the tests exercise the same library and metadata (`max`: full validation + number types).
import { parsePhoneNumberFromString } from 'npm:libphonenumber-js@1.13.15/max';

export type NormalizedPhone = {
  /** `+5493425551234`: what is stored and what the Cloud API receives (digits only). */
  e164: string;
  /** `+54 9 342 555 1234`: human readable, stored on a new Customer. */
  display: string;
};

export const DEFAULT_COUNTRY = 'AR';

/**
 * Accepts the formats people really type in Argentina (`342 555 1234`, `0342 15 555-1234`,
 * `(342) 5551234`, `+54 9 342 555 1234`, `5493425551234`) and international numbers.
 * Returns null when the number is not a valid phone number.
 *
 * Argentine mobiles have two spellings in E.164 (`+54 342…` and `+54 9 342…`); WhatsApp
 * accounts are mobiles, so the canonical form always carries the `9`. Without this the same
 * person would produce two different numbers depending on how they typed it.
 */
export function normalizeWhatsAppNumber(
  input: unknown,
  defaultCountry: string = DEFAULT_COUNTRY,
): NormalizedPhone | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text || text.length > 40) return null;
  if (/[^\d+()\-.\s]/.test(text)) return null;
  const parsed = parsePhoneNumberFromString(
    text,
    defaultCountry as Parameters<typeof parsePhoneNumberFromString>[1],
  );
  if (!parsed || !parsed.isValid()) return null;
  let e164 = parsed.number;
  if (parsed.countryCallingCode === '54') {
    const national = parsed.nationalNumber;
    if (national.length === 10) e164 = `+549${national}`;
    else if (national.length === 11 && national.startsWith('9'))
      e164 = `+54${national}`;
    else return null;
    const canonical = parsePhoneNumberFromString(e164);
    if (!canonical || !canonical.isValid()) return null;
    return { e164, display: canonical.formatInternational() };
  }
  return { e164, display: parsed.formatInternational() };
}

/**
 * Recipient format expected by the Cloud API (`wa_id`: digits, no plus).
 * Some Argentine accounts only resolve without the mobile `9`; `dropArgentineNine`
 * is a switch (WHATSAPP_AR_DROP_MOBILE_NINE) for that documented Meta quirk.
 */
export function toCloudApiRecipient(e164: string, dropArgentineNine = false) {
  const digits = e164.replace(/\D/g, '');
  if (dropArgentineNine && /^549\d{10}$/.test(digits))
    return `54${digits.slice(3)}`;
  return digits;
}
