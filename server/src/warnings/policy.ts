import type { Evidence, Finding, ReasonCode } from '../../../lib/contracts/assess';
import type { Fuel, ListingFacts, Transmission } from '../../../lib/contracts/listing';
import { mileageKm } from '../../../lib/contracts/listing';
import { bySeverity } from '../../../lib/contracts/reasons';
import { LIMITS } from '../../../lib/contracts/versions';
import type { Claim, ClaimName } from '../models/clairic';
import type { Judgements, QuestionName } from '../models/clef';

/** Provisional, versioned with WARNING_POLICY_VERSION. The yes threshold is not a calibrated fraud probability. */
export const WARNING_POLICY = {
  judgeYesAt: 0.5,
  mileageToleranceKm: 5000,
  mileageToleranceRatio: 0.15,
  yearTolerance: 1,
} as const;

type PolicyInput = {
  facts: ListingFacts;
  claims: Partial<Record<ClaimName, Claim>>;
  judgements: Judgements;
};

const PAYMENT_WORDS = /\b(deposit|pay|paid|payment|transfer|money|cash|revolut|western union|bank)\b|€/i;
const VIEWING_WORDS = /\b(view|viewing|viewed|see|seeing|inspect|inspection|test drive|collect|collection)\b/i;
const NEGATED_PAYMENT =
  /\b(no|never)\s+(deposit|payment|money)s?\b|\b(don't|do not|never)\s+(send|pay|transfer)\b|\bwithout\s+(a\s+|any\s+)?(deposit|payment)\b|\b(not|no)\s+(required|needed|necessary)\b/i;
const SHIPPING_WORDS = /\b(ship|shipped|shipping|deliver|delivered|delivery|courier|abroad|overseas|transport)\b/i;
const TRADE_WORDS = /\b(finance|trade[- ]?ins?|warranty|dealer|dealership|stock|showroom|garage|business|vat|invoice|part[- ]exchange)\b/i;
const SERVICE_WORDS = /\b(service|serviced|servicing|history|stamps?|book)\b/i;

function textEvidence(claim: Claim): Evidence {
  return { kind: 'text', start: claim.start, end: claim.end, excerpt: claim.excerpt };
}

function thousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const FUEL_NAMES: Record<Fuel, string> = {
  petrol: 'Petrol',
  diesel: 'Diesel',
  electric: 'Electric',
  petrol_hybrid: 'Petrol hybrid',
  diesel_hybrid: 'Diesel hybrid',
  petrol_plugin_hybrid: 'Petrol plug-in hybrid',
  diesel_plugin_hybrid: 'Diesel plug-in hybrid',
};

function said(input: PolicyInput, question: QuestionName): boolean {
  return (input.judgements[question] ?? 0) >= WARNING_POLICY.judgeYesAt;
}

/** Odometer reading in a phrase such as "120,000 km" or "40K MILES". */
export function claimedKm(excerpt: string): number | null {
  const match = /(\d+(?:[.,]\d+)*)\s*(k|thousand)?\s*(kms?|kilomet(?:er|re)s?|mi|miles?|mls)\b/i.exec(excerpt);
  if (!match?.[1] || !match[3]) return null;
  const number = Number(match[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
  if (!Number.isFinite(number)) return null;
  const value = match[2] && number < 1000 ? number * 1000 : number;
  return match[3].toLowerCase().startsWith('k') ? Math.round(value) : Math.round(value * 1.609344);
}

type FuelFamily = 'petrol' | 'diesel' | 'electric' | 'hybrid';

function claimedFuel(excerpt: string): FuelFamily | null {
  const families: FuelFamily[] = [];
  if (/\b(diesel|tdi|crdi|dci|hdi|tdci|cdti|bluehdi)\b/i.test(excerpt)) families.push('diesel');
  if (/\b(petrol|tsi|tfsi|gasoline)\b/i.test(excerpt)) families.push('petrol');
  if (/\b(electric|ev|bev)\b/i.test(excerpt)) families.push('electric');
  if (/\b(hybrid|phev|hev)\b/i.test(excerpt)) families.push('hybrid');
  return families.length === 1 ? (families[0] ?? null) : null;
}

function fuelConflicts(claim: FuelFamily, fact: Fuel): boolean {
  switch (claim) {
    case 'diesel':
      return fact === 'petrol' || fact === 'petrol_hybrid' || fact === 'petrol_plugin_hybrid' || fact === 'electric';
    case 'petrol':
      return fact === 'diesel' || fact === 'diesel_hybrid' || fact === 'diesel_plugin_hybrid' || fact === 'electric';
    case 'electric':
      return fact === 'petrol' || fact === 'diesel';
    case 'hybrid':
      return false;
    default: {
      const _exhaustive: never = claim;
      return _exhaustive;
    }
  }
}

function claimedTransmission(excerpt: string): Transmission | null {
  const manual = /\b(manual|mt)\b/i.test(excerpt);
  const automatic = /\b(automatic|auto|dsg|cvt|tiptronic|s[- ]?tronic|steptronic|powershift)\b/i.test(excerpt);
  if (manual === automatic) return null;
  return manual ? 'manual' : 'automatic';
}

function overlaps(a: Claim, b: Claim): boolean {
  return a.start < b.end && b.start < a.end;
}

type Rule = (input: PolicyInput) => Finding | null;

function finding(reason: ReasonCode, first: Evidence, ...rest: Evidence[]): Finding {
  return { reason, evidence: [first, ...rest] };
}

const RULES: Rule[] = [
  (input) => {
    const claim = input.claims.payment_statement;
    if (!claim || !said(input, 'payment_before_viewing')) return null;
    if (!PAYMENT_WORDS.test(claim.excerpt) || !VIEWING_WORDS.test(claim.excerpt)) return null;
    if (NEGATED_PAYMENT.test(claim.excerpt)) return null;
    return finding('payment_before_viewing', textEvidence(claim));
  },
  (input) => {
    const claim = input.claims.shipping_statement;
    if (!claim || !said(input, 'shipping_only') || !SHIPPING_WORDS.test(claim.excerpt)) return null;
    return finding('shipping_only', textEvidence(claim));
  },
  (input) => {
    const claim = input.claims.mileage_statement;
    const listed = input.facts.mileage;
    const claimed = claim ? claimedKm(claim.excerpt) : null;
    if (!claim || !listed || claimed === null) return null;
    const listedKm = mileageKm(listed);
    const tolerance = Math.max(WARNING_POLICY.mileageToleranceKm, listedKm * WARNING_POLICY.mileageToleranceRatio);
    if (Math.abs(claimed - listedKm) <= tolerance) return null;
    const value = `${thousands(listed.value)} ${listed.unit}`;
    return finding('mileage_mismatch', textEvidence(claim), { kind: 'field', field: 'mileage', value });
  },
  (input) => {
    const claim = input.claims.year_statement;
    const listed = input.facts.year;
    if (!claim || listed === null) return null;
    const years = new Set(claim.excerpt.match(/\b(19[5-9]\d|20[0-4]\d)\b/g) ?? []);
    const [claimed] = [...years];
    if (years.size !== 1 || claimed === undefined) return null;
    if (Math.abs(Number(claimed) - listed) <= WARNING_POLICY.yearTolerance) return null;
    return finding('year_mismatch', textEvidence(claim), { kind: 'field', field: 'year', value: String(listed) });
  },
  (input) => {
    const claim = input.claims.fuel_statement;
    const listed = input.facts.fuel;
    const claimed = claim ? claimedFuel(claim.excerpt) : null;
    if (!claim || !listed || !claimed || !fuelConflicts(claimed, listed)) return null;
    return finding('fuel_mismatch', textEvidence(claim), { kind: 'field', field: 'fuel', value: FUEL_NAMES[listed] });
  },
  (input) => {
    const claim = input.claims.transmission_statement;
    const listed = input.facts.transmission;
    const claimed = claim ? claimedTransmission(claim.excerpt) : null;
    if (!claim || !listed || !claimed || claimed === listed) return null;
    const value = listed === 'manual' ? 'Manual' : 'Automatic';
    return finding('transmission_mismatch', textEvidence(claim), { kind: 'field', field: 'transmission', value });
  },
  (input) => {
    const claim = input.claims.trade_statement;
    if (!claim || input.facts.sellerType !== 'private' || !said(input, 'business_seller')) return null;
    if (!TRADE_WORDS.test(claim.excerpt)) return null;
    return finding('private_seller_business_wording', textEvidence(claim), {
      kind: 'field',
      field: 'sellerType',
      value: 'Private seller',
    });
  },
  (input) => {
    const full = input.claims.service_full_statement;
    const gap = input.claims.service_gap_statement;
    if (!full || !gap || overlaps(full, gap) || !said(input, 'service_history_conflict')) return null;
    if (!SERVICE_WORDS.test(full.excerpt) || !SERVICE_WORDS.test(gap.excerpt)) return null;
    return finding('service_history_conflict', textEvidence(full), textEvidence(gap));
  },
];

export function questionsFor(input: Pick<PolicyInput, 'facts' | 'claims'>): QuestionName[] {
  const questions: QuestionName[] = [];
  if (input.claims.payment_statement) questions.push('payment_before_viewing');
  if (input.claims.shipping_statement) questions.push('shipping_only');
  if (input.claims.trade_statement && input.facts.sellerType === 'private') questions.push('business_seller');
  if (input.claims.service_full_statement && input.claims.service_gap_statement) questions.push('service_history_conflict');
  return questions;
}

/** Maps verified claims and judgements to displayable findings. Each needs real source evidence. */
export function findingsFrom(input: PolicyInput): Finding[] {
  return RULES.flatMap((rule) => rule(input) ?? [])
    .sort(bySeverity)
    .slice(0, LIMITS.maxFindings);
}
