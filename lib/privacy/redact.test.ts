import { describe, expect, test } from 'bun:test';
import { LIMITS } from '../contracts/versions';
import { isRedactedText, redact } from './redact';

describe('redact', () => {
  test('preserves calendar dates while removing slash-separated phone numbers', () => {
    const text = 'First registered 01/06/2015 in Japan. NCT 05/03/2027. Call 087/1234567.';
    expect<string>(redact(text)).toBe('First registered 01/06/2015 in Japan. NCT 05/03/2027. Call [phone].');
  });
  test('removes phone numbers, emails and links', () => {
    const text = redact('Call 087 123 4567 or +353 87 765 4321, or 01-234-5678. Email sam.k@example.ie, see www.example.com/car?id=1');
    expect<unknown>(text).toBe('Call [phone] or [phone], or [phone]. Email [email], see [link]');
  });

  test('removes international phone numbers before text is accepted as redacted', () => {
    for (const number of ['+44 7700 900123', '+1 (415) 555-0123', '0044 7700 900123']) {
      const text = `Call ${number} before viewing.`;
      expect<unknown>(redact(text)).toBe('Call [phone] before viewing.');
      expect(isRedactedText(text)).toBe(false);
      expect(isRedactedText(redact(text))).toBe(true);
    }
  });

  test('removes plates, VINs, Eircodes and long digit runs', () => {
    const text = redact('Reg 161-D-12345 and 12 KY 999. UK plate AB12 CDE. VIN WVWZZZ6RZGY123456. Near D02 X285. Ref 123456789.');
    expect<unknown>(text).toBe('Reg [reg] and [reg]. UK plate [reg]. VIN [vin]. Near [eircode]. Ref [number].');
  });

  test('removes identifiers regardless of letter case', () => {
    const text = 'Reg 161-d-12345 and 182-kE-9999. UK ab12 cde. VIN wvwzzz6rzgy123456. Near d02 x285.';
    expect<unknown>(redact(text)).toBe('Reg [reg] and [reg]. UK [reg]. VIN [vin]. Near [eircode].');
    expect(isRedactedText(text)).toBe(false);
  });

  test('keeps the vehicle facts that warnings compare', () => {
    const text = 'Only 40K MILES, 120,000 km on the clock. 2016 1.5 TSI DSG, €10,495 or From €218/mo. 1.2 Petrol.';
    expect<unknown>(redact(text)).toBe(text);
  });

  test.each([
    'BMW 320d 2010 163bhp NCT',
    'VW Golf 2.0 TDI 140 D 2012 leather',
    'Audi A4 2.0 TDI 150 d 2014',
    'BMW 320D2010 163bhp NCT',
    '2010 BMW 320d, 120,000 km, 163 bhp.',
    '87,123 km on the clock. 2012 1.6 diesel, €10,495.',
    'Mileage 52 000 km. 2014, 150 bhp, €5 000.',
  ])('preserves engine, year and mileage facts: %s', (text) => {
    expect<unknown>(redact(text)).toBe(text);
    expect(isRedactedText(text)).toBe(true);
  });

  test.each([
    ['161-D-12345', '[reg]'], ['12 KY 999', '[reg]'], ['87-d-1', '[reg]'], ['00c1234', '[reg]'],
    ['131-D-1', '[reg]'], ['132d12345', '[reg]'], ['182-kE-9999', '[reg]'], ['242 C 12345', '[reg]'],
    ['ab12 cde', '[reg]'], ['AB12CDE', '[reg]'], ['wvwzzz6rzgy123456', '[vin]'], ['d02 x285', '[eircode]'],
  ])('removes real identifiers beside preserved vehicle facts: %s', (identifier, expectedIdentifier) => {
    const text = `BMW 320d 2010 163bhp NCT. Identifier ${identifier}. Mileage 120,000 km.`;
    const expected = `BMW 320d 2010 163bhp NCT. Identifier ${expectedIdentifier}. Mileage 120,000 km.`;
    expect<unknown>(redact(text)).toBe(expected);
    expect(isRedactedText(text)).toBe(false);
    expect<unknown>(redact(redact(text))).toBe(expected);
  });

  test.each([
    '(087) 123 4567', '(087)1234567', '87 123 4567', '87 1234567',
    '087/1234567', '087/123/4567', '087 123 4567', '0871234567',
    '086 123 4567', '85 123 4567', '+353 (0)87 123 4567',
  ])('redacts the whole phone number without leaving a prefix: %s', (number) => {
    const text = `Call ${number} before viewing. Mileage 87,123 km. Year 2010.`;
    const expected = 'Call [phone] before viewing. Mileage 87,123 km. Year 2010.';
    expect<unknown>(redact(text)).toBe(expected);
    expect(isRedactedText(text)).toBe(false);
    expect<unknown>(redact(redact(text))).toBe(expected);
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
