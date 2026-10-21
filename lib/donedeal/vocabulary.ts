import type { AskingPrice, Fuel, Mileage, SellerType, Transmission } from '../contracts/listing';

const FUELS: Record<string, Fuel> = {
  petrol: 'petrol',
  diesel: 'diesel',
  electric: 'electric',
  'petrol hybrid': 'petrol_hybrid',
  'diesel hybrid': 'diesel_hybrid',
  'petrol plug-in hybrid': 'petrol_plugin_hybrid',
  'diesel plug-in hybrid': 'diesel_plugin_hybrid',
  'plug-in petrol hybrid': 'petrol_plugin_hybrid',
  'plug-in diesel hybrid': 'diesel_plugin_hybrid',
};

const TRANSMISSIONS: Record<string, Transmission> = {
  manual: 'manual',
  automatic: 'automatic',
};

export function cleanText(text: string | null | undefined): string {
  return (text ?? '').replace(/[\s ]+/g, ' ').trim();
}

export function parseFuel(text: string): Fuel | null {
  return FUELS[cleanText(text).toLowerCase()] ?? null;
}

export function parseTransmission(text: string): Transmission | null {
  return TRANSMISSIONS[cleanText(text).toLowerCase()] ?? null;
}

export function parseSellerTypeCode(code: string): SellerType | null {
  const normalised = cleanText(code).toLowerCase();
  if (normalised === 'pro') return 'dealer';
  if (normalised === 'private') return 'private';
  return null;
}

export function parseYear(text: string): number | null {
  const match = /^(19|20)\d{2}$/.exec(cleanText(text));
  return match ? Number(match[0]) : null;
}

export function parseMileageText(text: string): Mileage | null {
  const match = /^(\d{1,3}(?:,\d{3})*|\d+)\s*(km|kms|mi|miles|mls)$/i.exec(cleanText(text));
  if (!match?.[1] || !match[2]) return null;
  const value = Number(match[1].replaceAll(',', ''));
  return { value, unit: match[2].toLowerCase().startsWith('k') ? 'km' : 'mi' };
}

export function parseEngineLitres(text: string): number | null {
  const match = /^(\d{1,2}\.\d)\s*l?$/i.exec(cleanText(text));
  return match?.[1] ? Number(match[1]) : null;
}

export function parseEngineAndFuel(text: string): { engineLitres: number | null; fuel: Fuel } | null {
  const match = /^(?:(\d{1,2}\.\d)\s+)?(.+)$/.exec(cleanText(text));
  const fuel = match?.[2] ? parseFuel(match[2]) : null;
  if (!fuel) return null;
  return { engineLitres: match?.[1] ? Number(match[1]) : null, fuel };
}

export function parseEuroText(text: string): number | null {
  const match = /^€\s?(\d{1,3}(?:,\d{3})*|\d+)$/.exec(cleanText(text));
  return match?.[1] ? Number(match[1].replaceAll(',', '')) : null;
}

export function parseHeadlinePrice(text: string | null): AskingPrice {
  const cleaned = cleanText(text);
  if (cleaned === '') return { kind: 'missing' };
  if (/(\/\s*mo\b|per month|p\/m|\bpm\b|monthly)/i.test(cleaned)) return { kind: 'finance_only' };
  if (/(price on request|\bpoa\b|on request)/i.test(cleaned)) return { kind: 'on_request' };
  const eur = parseEuroText(cleaned);
  return eur && eur > 0 ? { kind: 'cash', eur } : { kind: 'missing' };
}

const DAMAGE =
  /\b(damaged|accident damage|crashed|spares?\s*(?:or|\/|&|and)\s*repairs?|for parts|parts only|breaking|non[- ]?runner|write[- ]?off|written off|salvage|cat\s?[abns])\b/i;
const DENIED_DAMAGE_TERM = '(?:damaged|crashed|written\\s+off|write[- ]?off|(?:a\\s+)?cat\\s?[abns])';
const DENIED_DAMAGE = new RegExp(`\\b(?:never|not)\\s+(?:(?:been|a)\\s+)*${DENIED_DAMAGE_TERM}(?:\\s+(?:or|and)\\s+${DENIED_DAMAGE_TERM})*\\b`, 'gi');

export function mentionsDamage(text: string): boolean {
  const asserted = text
    .replace(DENIED_DAMAGE, '')
    .replace(/\b(?:(?:city|automatic|autonomous|emergency|active)\s+)+(?:braking|breaking)\b/gi, '')
    .replace(/\b(?:invoices?|receipts?|bills?)\s+for\s+parts(?:\s+(?:and|&)\s+labou?r)?\b/gi, '')
    .replace(/\bno\s+(?:accident\s+damage|history\s+of\s+(?:accident\s+damage|being\s+written\s+off))\b/gi, '');
  return DAMAGE.test(asserted);
}
