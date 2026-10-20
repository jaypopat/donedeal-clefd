import type { Comparable, EssentialField, InsufficientReason, PriceLabel, PriceResult } from '../../lib/contracts/assess';
import type { ListingFacts } from '../../lib/contracts/listing';
import { mileageKm } from '../../lib/contracts/listing';
import { LIMITS } from '../../lib/contracts/versions';

/** Provisional prototype thresholds. Review them against labelled searches before trusting them. */
export const PRICE_POLICY = {
  minMatches: 5,
  minPlausibleEur: 500,
  greatAtOrBelow: -0.15,
  expensiveAtOrAbove: 0.15,
  maxQuartileSpreadRatio: 0.35,
  engineToleranceLitres: 0.15,
  window: { years: 2, km: 20_000, kmRatio: 0.2 },
  tightWindow: { years: 1, km: 12_000, kmRatio: 0.12 },
} as const;

type Window = { years: number; km: number; kmRatio: number };

/** A listing with every essential fact known and a plausible cash price. */
type Comparand = {
  facts: ListingFacts;
  eur: number;
  km: number;
  year: number;
  identity: string;
};

const ESSENTIAL_FIELDS = ['make', 'model', 'year', 'mileage', 'fuel', 'transmission', 'sellerType'] as const satisfies readonly EssentialField[];

function normalisedName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function missingEssentials(facts: ListingFacts): EssentialField[] {
  return ESSENTIAL_FIELDS.filter((field) => facts[field] === null);
}

function toComparand(facts: ListingFacts): Comparand | null {
  if (facts.price.kind !== 'cash' || facts.price.eur < PRICE_POLICY.minPlausibleEur) return null;
  const { make, model, fuel, transmission, sellerType, year, mileage } = facts;
  if (!make || !model || !fuel || !transmission || !sellerType || year === null || !mileage) return null;
  const identity = [normalisedName(make), normalisedName(model), fuel, transmission, sellerType].join('|');
  return { facts, eur: facts.price.eur, km: mileageKm(mileage), year, identity };
}

function withinWindow(target: Comparand, candidate: Comparand, window: Window): boolean {
  const kmTolerance = Math.max(window.km, target.km * window.kmRatio);
  return Math.abs(candidate.year - target.year) <= window.years && Math.abs(candidate.km - target.km) <= kmTolerance;
}

function engineCompatible(target: ListingFacts, candidate: ListingFacts): boolean {
  if (target.engineLitres === null || candidate.engineLitres === null) return true;
  return Math.abs(target.engineLitres - candidate.engineLitres) <= PRICE_POLICY.engineToleranceLitres;
}

/** Same year, mileage and price as another ad: most likely the same car listed twice. */
function duplicateKey(comparand: Comparand): string {
  return `${comparand.identity}|${comparand.year}|${comparand.km}|${comparand.eur}`;
}

function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

function median(prices: readonly number[]): number {
  return quantile([...prices].sort((a, b) => a - b), 0.5);
}

function labelFor(targetEur: number, medianEur: number): PriceLabel {
  const delta = (targetEur - medianEur) / medianEur;
  if (delta <= PRICE_POLICY.greatAtOrBelow) return 'great';
  if (delta >= PRICE_POLICY.expensiveAtOrAbove) return 'expensive';
  return 'typical';
}

function matchesFor(target: Comparand, pool: readonly Comparand[], window: Window): Comparand[] {
  const targetDuplicate = duplicateKey(target);
  const byDuplicate = new Map<string, Comparand>();
  for (const candidate of pool) {
    if (candidate.identity !== target.identity) continue;
    if (!withinWindow(target, candidate, window) || !engineCompatible(target.facts, candidate.facts)) continue;
    const key = duplicateKey(candidate);
    if (key === targetDuplicate || byDuplicate.has(key)) continue;
    byDuplicate.set(key, candidate);
  }
  return [...byDuplicate.values()];
}

/** The label survives dropping any one comparable and tightening the matching window. */
function isStable(target: Comparand, matches: readonly Comparand[], pool: readonly Comparand[], label: PriceLabel): boolean {
  const prices = matches.map((match) => match.eur);
  for (let skip = 0; skip < prices.length; skip++) {
    const rest = prices.filter((_, index) => index !== skip);
    if (labelFor(target.eur, median(rest)) !== label) return false;
  }
  const tight = matchesFor(target, pool, PRICE_POLICY.tightWindow);
  if (tight.length < PRICE_POLICY.minMatches) return true;
  return labelFor(target.eur, median(tight.map((match) => match.eur))) === label;
}

function closest(target: Comparand, matches: readonly Comparand[]): Comparable[] {
  const distance = (match: Comparand) => Math.abs(match.year - target.year) + Math.abs(match.km - target.km) / 20_000;
  return [...matches]
    .sort((a, b) => distance(a) - distance(b) || a.facts.listingId.localeCompare(b.facts.listingId))
    .slice(0, LIMITS.maxComparables)
    .map((match) => ({
      listingId: match.facts.listingId,
      url: match.facts.url,
      priceEur: match.eur,
      year: match.year,
      mileageKm: match.km,
    }));
}

/**
 * Compares a target with close matches among the supplied search candidates.
 * Abstains rather than falling back to a typical label.
 */
export function assessPrice(input: { target: ListingFacts; candidates: readonly ListingFacts[] }): PriceResult {
  const others = input.candidates
    .filter((candidate) => candidate.listingId !== input.target.listingId)
    .filter((candidate) => !candidate.damageMentioned);
  const pool = others.flatMap((candidate) => toComparand(candidate) ?? []);
  const unknownFactCount = others.filter((candidate) => missingEssentials(candidate).length > 0).length;
  const insufficient = (reason: InsufficientReason, matchCount = 0): PriceResult => ({
    kind: 'insufficient',
    reason,
    matchCount,
    unknownFactCount,
  });

  const [firstMissing, ...restMissing] = missingEssentials(input.target);
  if (firstMissing) return insufficient({ code: 'unknown_facts', fields: [firstMissing, ...restMissing] });
  if (input.target.damageMentioned) return insufficient({ code: 'damage_mentioned' });
  const target = toComparand(input.target);
  if (!target) return insufficient({ code: 'no_cash_price' });

  const matches = matchesFor(target, pool, PRICE_POLICY.window);
  if (matches.length < PRICE_POLICY.minMatches) return insufficient({ code: 'too_few_matches' }, matches.length);

  const sorted = matches.map((match) => match.eur).sort((a, b) => a - b);
  const medianEur = quantile(sorted, 0.5);
  const lowerQuartileEur = quantile(sorted, 0.25);
  const upperQuartileEur = quantile(sorted, 0.75);
  if ((upperQuartileEur - lowerQuartileEur) / medianEur > PRICE_POLICY.maxQuartileSpreadRatio) {
    return insufficient({ code: 'dispersed' }, matches.length);
  }
  const label = labelFor(target.eur, medianEur);
  if (!isStable(target, matches, pool, label)) return insufficient({ code: 'unstable' }, matches.length);

  return {
    kind: 'ready',
    label,
    targetEur: target.eur,
    medianEur: Math.round(medianEur),
    lowerQuartileEur: Math.round(lowerQuartileEur),
    upperQuartileEur: Math.round(upperQuartileEur),
    deltaPercent: Math.round(((target.eur - medianEur) / medianEur) * 1000) / 10,
    matchCount: matches.length,
    unknownFactCount,
    comparables: closest(target, matches),
  };
}
