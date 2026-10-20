import { LIMITS } from '../contracts/versions';

/** Listing text after contact and identifier removal, whitespace normalisation and truncation. */
export type RedactedText = string & { readonly __brand: 'RedactedText' };

const IRISH_COUNTY = 'CE|CN|CW|DL|KE|KK|KY|LD|LH|LK|LM|LS|MH|MN|MO|OY|RN|SO|TN|TS|WD|WH|WX|WW|C|D|G|L|T|W';

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, '[link]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi, '[email]'],
  [/(?:\+|\b00)[ \t().-]*[1-9](?:[ \t().-]*\d){6,14}\b/g, '[phone]'],
  [/\b0\d{1,2}(?:[\s.-]?\d){6,8}\b/g, '[phone]'],
  [/\b\d{7,}\b/g, '[number]'],
  [/\b(?=[A-HJ-NPR-Z0-9]*\d)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b/gi, '[vin]'],
  [new RegExp(`\\b\\d{2,3}[\\s-]?(?:${IRISH_COUNTY})[\\s-]?\\d{1,6}\\b`, 'gi'), '[reg]'],
  [/\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/gi, '[reg]'],
  [/\b[AC-FHKNPRTV-Y]\d{2}\s?[0-9AC-FHKNPRTV-Y]{4}\b/gi, '[eircode]'],
];

function applyRules(text: string): string {
  return RULES.reduce((current, [pattern, placeholder]) => current.replace(pattern, placeholder), text);
}

function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v   -​  　 ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(text: string, maxCodepoints: number): string {
  const codepoints = Array.from(text);
  return codepoints.length <= maxCodepoints ? text : codepoints.slice(0, maxCodepoints).join('').trimEnd();
}

function pass(text: string): string {
  return truncate(normaliseWhitespace(applyRules(text)), LIMITS.maxTextCodepoints);
}

/**
 * Removes links, emails, phone numbers, long digit runs, VINs, plates and Eircodes.
 * Idempotent, so the Worker can verify that submitted text is already redacted.
 */
export function redact(text: string): RedactedText {
  let current = pass(truncate(text, LIMITS.maxTextCodepoints * 2));
  for (let attempt = 0; attempt < 5; attempt++) {
    if (isRedactedText(current)) return current;
    current = pass(current);
  }
  throw new Error('redaction did not converge');
}

export function isRedactedText(value: unknown): value is RedactedText {
  return typeof value === 'string' && pass(value) === value;
}
