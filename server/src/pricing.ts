import type { Comparable, EssentialField, InsufficientReason, MatchBounds, PartialField, PriceLabel, PriceResult } from '../../lib/contracts/assess';
import type { ListingFacts } from '../../lib/contracts/listing';
import { mileageKm } from '../../lib/contracts/listing';
import { LIMITS, MIN_PRICE_MATCHES } from '../../lib/contracts/versions';
import { catalogKey, variantsFor } from '../../lib/contracts/variants';

export const PRICE_POLICY = {
  minMatches: MIN_PRICE_MATCHES,
  minPlausibleEur: 500,
  greatAtOrBelow: -0.15,
  expensiveAtOrAbove: 0.15,
  maxQuartileSpreadRatio: 0.35,
  engineToleranceLitres: 0.15,
  window: { years: 2, km: 20_000, kmRatio: 0.2 },
  tightWindow: { years: 1, km: 12_000, kmRatio: 0.12 },
} as const;

type Window = { years: number; km: number; kmRatio: number };

type Comparand = {
  facts: ListingFacts;
  eur: number;
  km: number;
  year: number;
  identity: string;
};
type Related = { match: Comparand; unconfirmed: PartialField[] };

const HARD_FIELDS = ['make', 'model', 'year', 'mileage', 'fuel'] as const satisfies readonly EssentialField[];
const SOFT_FIELDS = ['transmission', 'sellerType'] as const satisfies readonly PartialField[];

function soft(facts: ListingFacts, field: PartialField): string | null {
  if (field === 'transmission' && facts.titleEvidence.conflicts.includes('transmission')) return null;
  return facts[field];
}

function toComparand(facts: ListingFacts): Comparand | null {
  if (facts.damageMentioned || facts.price.kind !== 'cash' || facts.price.eur < PRICE_POLICY.minPlausibleEur) return null;
  const { make, model, fuel, year, mileage, variant } = facts;
  if (!make || !model || !fuel || year === null || !mileage || variant.kind === 'ambiguous') return null;
  if (facts.titleEvidence.conflicts.some((field) => field === 'make' || field === 'model')) return null;
  const variantKey = variant.kind === 'marked' ? `marked:${variant.code}` : variant.kind;
  const identity = [catalogKey(make, model), fuel, variantKey].join('|');
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

function duplicateKey(comparand: Comparand): string {
  return `${comparand.identity}|${soft(comparand.facts, 'transmission')}|${soft(comparand.facts, 'sellerType')}|${comparand.year}|${comparand.km}|${comparand.eur}`;
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

function matchesFor(target: Comparand, pool: readonly Comparand[], window: Window): Related[] {
  const related: Related[] = [];
  for (const candidate of pool) {
    if (candidate.identity !== target.identity || candidate.facts.listingId === target.facts.listingId) continue;
    if (!withinWindow(target, candidate, window) || !engineCompatible(target.facts, candidate.facts)) continue;
    const unconfirmed: PartialField[] = [];
    let mismatch = false;
    for (const field of SOFT_FIELDS) {
      const a = soft(target.facts, field);
      const b = soft(candidate.facts, field);
      if (a !== null && b !== null && a !== b) mismatch = true;
      if (a === null || b === null) unconfirmed.push(field);
    }
    if (!mismatch) related.push({ match: candidate, unconfirmed });
  }
  const seenIds = new Set<string>();
  const seenFacts = new Set([duplicateKey(target)]);
  return related.sort((a, b) => a.unconfirmed.length - b.unconfirmed.length).filter(({ match }) => {
    const key = duplicateKey(match);
    if (seenIds.has(match.facts.listingId) || seenFacts.has(key)) return false;
    seenIds.add(match.facts.listingId);
    seenFacts.add(key);
    return true;
  });
}

function isStable(target: Comparand, matches: readonly Comparand[], pool: readonly Comparand[], label: PriceLabel): boolean {
  const prices = matches.map((match) => match.eur);
  for (let skip = 0; skip < prices.length; skip++) {
    const rest = prices.filter((_, index) => index !== skip);
    if (labelFor(target.eur, median(rest)) !== label) return false;
  }
  const tight = matchesFor(target, pool, PRICE_POLICY.tightWindow).filter((related) => related.unconfirmed.length === 0).map((related) => related.match);
  if (tight.length < PRICE_POLICY.minMatches) return true;
  return labelFor(target.eur, median(tight.map((match) => match.eur))) === label;
}

function closest(target: Comparand, related: readonly Related[]): Comparable[] {
  const distance = (match: Comparand) => Math.abs(match.year - target.year) + Math.abs(match.km - target.km) / 20_000;
  return [...related]
    .sort((a, b) => Number(a.unconfirmed.length > 0) - Number(b.unconfirmed.length > 0) ||
      distance(a.match) - distance(b.match) || a.match.facts.listingId.localeCompare(b.match.facts.listingId))
    .slice(0, LIMITS.maxComparables)
    .map(({ match, unconfirmed }) => ({
      listingId: match.facts.listingId,
      url: match.facts.url,
      priceEur: match.eur,
      year: match.year,
      mileageKm: match.km,
      variant: match.facts.variant.kind === 'marked' ? match.facts.variant.code : null,
      unconfirmed,
    }));
}

function bounds(target: ListingFacts, related: readonly Related[]): MatchBounds {
  const variant = target.variant;
  return {
    variant: variant.kind === 'marked' || variant.kind === 'unmarked'
      ? { kind: 'separated', codes: variantsFor(target.make, target.model),
          target: variant.kind === 'marked' ? { kind: 'marked', code: variant.code } : { kind: 'unmarked' } }
      : { kind: 'not_separated' },
    targetFromTitle: target.titleEvidence.recovered,
    targetFromSearch: target.searchEvidence,
    targetConflicts: target.titleEvidence.conflicts,
    matchesFromTitle: related.filter(({ match }) => match.facts.titleEvidence.recovered.length > 0).length,
    matchesFromSearch: related.filter(({ match }) => match.facts.searchEvidence.length > 0).length,
  };
}

export function assessPrice(input: { target: ListingFacts; candidates: readonly ListingFacts[] }): PriceResult {
  const others = input.candidates.filter((candidate) => candidate.listingId !== input.target.listingId && !candidate.damageMentioned);
  const pool = others.flatMap((candidate) => toComparand(candidate) ?? []);
  const unknown = (facts: ListingFacts) => HARD_FIELDS.some((field) => facts[field] === null) ||
    SOFT_FIELDS.some((field) => soft(facts, field) === null) || facts.variant.kind === 'ambiguous' || facts.titleEvidence.conflicts.length > 0;
  const excludedUnknown = new Set(others.filter(unknown).map((candidate) => candidate.listingId));
  const insufficient = (reason: InsufficientReason): PriceResult => ({
    kind: 'insufficient', reason, unknownFactCount: excludedUnknown.size,
  });

  if (input.target.damageMentioned) return insufficient({ code: 'damage_mentioned' });
  if (input.target.price.kind !== 'cash' || input.target.price.eur < PRICE_POLICY.minPlausibleEur) return insufficient({ code: 'no_cash_price' });
  const [firstMissing, ...restMissing] = HARD_FIELDS.filter((field) => input.target[field] === null);
  if (firstMissing) return insufficient({ code: 'unknown_facts', fields: [firstMissing, ...restMissing] });
  if (input.target.variant.kind === 'ambiguous') return insufficient({ code: 'variant_uncertain' });
  const [firstConflict, ...restConflicts] = input.target.titleEvidence.conflicts.filter((field) => field === 'make' || field === 'model');
  if (firstConflict) return insufficient({ code: 'conflicting_facts', fields: [firstConflict, ...restConflicts] });
  const target = toComparand(input.target);
  if (!target) return insufficient({ code: 'no_close_matches' });

  const related = matchesFor(target, pool, PRICE_POLICY.window);
  const exact = related.filter((relation) => relation.unconfirmed.length === 0);
  const included = exact.length >= PRICE_POLICY.minMatches ? exact : related;
  for (const { match } of included) excludedUnknown.delete(match.facts.listingId);
  const unknownFactCount = excludedUnknown.size;
  const reference = (why: 'few_matches' | 'dispersed' | 'unstable', selected: Related[]): PriceResult => ({
    kind: 'reference', why, targetEur: target.eur,
    exactCount: exact.length, partialCount: selected.length - exact.length,
    unknownFactCount, comparables: closest(target, selected), bounds: bounds(input.target, selected),
  });
  if (exact.length < PRICE_POLICY.minMatches) {
    if (related.length > 0) return reference('few_matches', related);
    const [firstSoft, ...restSoft] = SOFT_FIELDS.filter((field) => soft(input.target, field) === null);
    return firstSoft ? insufficient({ code: 'unknown_facts', fields: [firstSoft, ...restSoft] }) : insufficient({ code: 'no_close_matches' });
  }

  const matches = exact.map((relation) => relation.match);
  const sorted = matches.map((match) => match.eur).sort((a, b) => a - b);
  const medianEur = quantile(sorted, 0.5);
  const lowerQuartileEur = quantile(sorted, 0.25);
  const upperQuartileEur = quantile(sorted, 0.75);
  if ((upperQuartileEur - lowerQuartileEur) / medianEur > PRICE_POLICY.maxQuartileSpreadRatio) return reference('dispersed', exact);
  const label = labelFor(target.eur, medianEur);
  if (!isStable(target, matches, pool, label)) return reference('unstable', exact);

  return {
    kind: 'ready', label, targetEur: target.eur,
    medianEur: Math.round(medianEur),
    lowerQuartileEur: Math.round(lowerQuartileEur),
    upperQuartileEur: Math.round(upperQuartileEur),
    deltaPercent: Math.round(((target.eur - medianEur) / medianEur) * 1000) / 10,
    matchCount: matches.length, unknownFactCount,
    comparables: closest(target, exact), bounds: bounds(input.target, exact),
  };
}
