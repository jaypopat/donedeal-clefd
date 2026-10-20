import { describe, expect, test } from 'bun:test';
import { LIMITS } from '../contracts/versions';
import { isRedactedText, redact } from './redact';

describe('redact', () => {
  test('removes phone numbers, emails and links', () => {
    const text = redact('Call 087 123 4567 or +353 87 765 4321, or 01-234-5678. Email sam.k@example.ie, see www.example.com/car?id=1');
    expect<unknown>(text).toBe('Call [phone] or [phone], or [phone]. Email [email], see [link]');
  });

  test('removes plates, VINs, Eircodes and long digit runs', () => {
    const text = redact('Reg 161-D-12345 and 12 KY 999. UK plate AB12 CDE. VIN WVWZZZ6RZGY123456. Near D02 X285. Ref 123456789.');
    expect<unknown>(text).toBe('Reg [reg] and [reg]. UK plate [reg]. VIN [vin]. Near [eircode]. Ref [number].');
  });

  test('keeps the vehicle facts that warnings compare', () => {
    const text = 'Only 40K MILES, 120,000 km on the clock. 2016 1.5 TSI DSG, €10,495 or From €218/mo. 1.2 Petrol.';
    expect<unknown>(redact(text)).toBe(text);
  });

  test('is idempotent so the Worker can verify submitted text', () => {
    const samples = [
      'Call 087 123 45678 now',
      'Text me on 0871234567 or sam@example.ie',
      `${'Great car. '.repeat(600)}Call 087 123 4567`,
      '🚗 The mileage is 120,000 km.',
    ];
    for (const sample of samples) {
      const once = redact(sample);
      expect(redact(once)).toBe(once);
      expect(isRedactedText(once)).toBe(true);
    }
    expect(isRedactedText('Call 087 123 4567')).toBe(false);
  });

  test('limits length in codepoints without splitting surrogate pairs', () => {
    const text = redact('🚗'.repeat(LIMITS.maxTextCodepoints + 50));
    expect(Array.from(text).length).toBe(LIMITS.maxTextCodepoints);
    expect(text.endsWith('🚗')).toBe(true);
  });

  test('normalises whitespace', () => {
    expect<unknown>(redact('  Full service   history\r\n\r\n\r\n\r\nNo   time wasters ')).toBe('Full service history\n\nNo time wasters');
  });
});
