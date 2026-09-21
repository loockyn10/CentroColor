import { describe, expect, it } from 'vitest';
import { formatCents, parsePrice } from './pos';

describe('POS money input and display', () => {
  it('converts decimal text to integer cents without rounding', () => {
    expect(parsePrice('12345,67')).toBe(1234567);
    expect(parsePrice('0,01')).toBe(1);
    expect(formatCents(1234567)).toBe('$12.345,67');
  });

  it('rejects fractions beyond cents and unsafe amounts', () => {
    expect(() => parsePrice('1,001')).toThrow('precio válido');
    expect(() => parsePrice('90071992547410')).toThrow('máximo');
  });
});
