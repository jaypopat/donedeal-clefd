import { describe, expect, test } from 'bun:test';
import type { ListingFacts } from '../../lib/contracts/listing';
import { facts } from '../../tests/support/listings';
import { assessPrice } from '../src/pricing';
import { PriceResultSchema } from '../../lib/contracts/assess';
import { readIdentity } from '../../lib/donedeal/identity';

let nextId = 41000000;
function car(eur: number | null, overrides: Partial<Omit<ListingFacts, 'listingId' | 'url'>> = {}): ListingFacts {
  nextId += 1;
  return facts({ id: String(nextId), eur, mileage: { value: 90000 + (nextId % 7) * 1000, unit: 'km' }, ...overrides });
}

function cohort(prices: number[], overrides: Partial<Omit<ListingFacts, 'listingId' | 'url'>> = {}): ListingFacts[] {
  return prices.map((eur) => car(eur, overrides));
}

const CLOSE = [17000, 17500, 18000, 18500, 19000, 19500];

describe('search-relative price', () => {
  test('one to four close matches give loaded links without any qualitative label', () => {
    const target = car(15000);
    for (let count = 1; count <= 4; count++) {
      const candidates = cohort(CLOSE.slice(0, count));
      const result = PriceResultSchema.parse(assessPrice({ target, candidates }));
      expect(result).toMatchObject({ kind: 'reference', why: 'few_matches', exactCount: count, partialCount: 0 });
      expect(result).not.toHaveProperty('label');
      if (result.kind !== 'reference') throw new Error('expected reference');
      expect(result.comparables).toHaveLength(count);
      expect(new Set(result.comparables.map((comparable) => comparable.listingId)).size).toBe(count);
      for (const comparable of result.comparables) {
        expect(candidates.find((candidate) => candidate.listingId === comparable.listingId)?.url).toBe(comparable.url);
        expect(comparable.unconfirmed).toEqual([]);
      }
    }
    expect(assessPrice({ target, candidates: [] })).toMatchObject({ kind: 'insufficient', reason: { code: 'no_close_matches' } });
  });

  test('marked and unmarked cohorts stay separate, including R-Line and Aqua GS versus GR Sport', () => {
    const target = car(15000);
    for (const code of ['gti', 'gtd', 'gte', 'r', 'r_line'] as const) {
      const marked = cohort(CLOSE, { variant: { kind: 'marked', code, source: 'title' } });
      expect(assessPrice({ target, candidates: marked })).toMatchObject({ kind: 'insufficient', reason: { code: 'no_close_matches' } });
      const markedTarget = car(15000, { variant: { kind: 'marked', code, source: 'trim' } });
      expect(assessPrice({ target: markedTarget, candidates: cohort(CLOSE) }).kind).toBe('insufficient');
      const ready = PriceResultSchema.parse(assessPrice({ target: markedTarget, candidates: marked }));
      expect(ready).toMatchObject({ kind: 'ready', bounds: { variant: { kind: 'separated', target: { kind: 'marked', code } } } });
    }
    const aqua = { make: 'Toyota', model: 'Aqua', fuel: 'petrol_hybrid', transmission: 'automatic', engineLitres: 1.5 } as const;
    const gs = car(12500, { ...aqua, variant: { kind: 'marked', code: 'gs', source: 'title' } });
    const ordinary = cohort([8000, 8500, 9000, 9500, 10000, 10500], aqua);
    const gr = cohort(CLOSE, { ...aqua, variant: { kind: 'marked', code: 'gr_sport', source: 'title' } });
    expect(assessPrice({ target: gs, candidates: [...ordinary, ...gr] }).kind).toBe('insufficient');
  });

  test('uncertain variants and known identity contradictions cannot produce labels', () => {
    const candidates = cohort(CLOSE);
    expect(assessPrice({ target: car(15000, { variant: { kind: 'ambiguous' } }), candidates })).toMatchObject({ reason: { code: 'variant_uncertain' } });
    const contradictory = readIdentity({ title: 'Volkswagen Polo', listed: { make: 'Volkswagen', model: 'Golf', transmission: 'manual', year: 2018 }, corroborate: null, trim: null });
    expect(assessPrice({ target: car(15000, contradictory), candidates })).toMatchObject({ reason: { code: 'conflicting_facts', fields: ['model'] } });
    expect(assessPrice({ target: car(15000), candidates: cohort(CLOSE, contradictory) })).toMatchObject({ kind: 'insufficient' });
  });

  test('unknown or title-conflicting gearbox and seller fields are tagged partials and never labelled matches', () => {
    const target = car(15000);
    const partials = [
      car(17700, { transmission: null }), car(18100, { sellerType: null }),
      car(18300, { titleEvidence: { recovered: [], conflicts: ['transmission'] } }),
    ];
    const result = PriceResultSchema.parse(assessPrice({ target, candidates: [...cohort([17000, 17500, 18000, 18500]), ...partials] }));
    expect(result).toMatchObject({ kind: 'reference', exactCount: 4, partialCount: 3 });
    if (result.kind !== 'reference') throw new Error('expected reference');
    expect(result.comparables[4]?.unconfirmed.length).toBeGreaterThan(0);
    for (const partial of partials) {
      const alone = assessPrice({ target, candidates: [partial] });
      expect(alone).toMatchObject({ kind: 'reference', exactCount: 0, partialCount: 1 });
    }
    const conflictedTarget = car(15000, { titleEvidence: { recovered: [], conflicts: ['transmission'] } });
    expect(assessPrice({ target: conflictedTarget, candidates: cohort(CLOSE) })).toMatchObject({ kind: 'reference', exactCount: 0, partialCount: 6 });
    const labelled = assessPrice({ target, candidates: [...cohort(CLOSE), ...partials] });
    expect(labelled).toMatchObject({ kind: 'ready', matchCount: 6, unknownFactCount: 3 });
    if (labelled.kind !== 'ready') throw new Error('expected ready');
    expect(labelled.comparables.every((comparable) => comparable.unconfirmed.length === 0)).toBe(true);
  });

  test('missing hard identity facts cannot inflate labelled match counts', () => {
    const target = car(15000);
    for (const field of ['make', 'model', 'year', 'mileage', 'fuel'] as const) {
      const result = assessPrice({ target, candidates: [...cohort(CLOSE.slice(0, 4)), ...cohort(CLOSE, { [field]: null })] });
      expect(result).toMatchObject({ kind: 'reference', exactCount: 4, partialCount: 0, unknownFactCount: 6 });
      expect(assessPrice({ target: car(15000, { [field]: null }), candidates: cohort(CLOSE) })).toMatchObject({ kind: 'insufficient', reason: { code: 'unknown_facts', fields: [field] } });
    }
  });

  test('title recovery can support exact matching with its evidence disclosed', () => {
    const identity = readIdentity({ title: 'Volkswagen Golf manual', listed: { make: null, model: null, transmission: null, year: 2018 }, corroborate: { make: 'Volkswagen', model: 'Golf' }, trim: null });
    const result = assessPrice({ target: car(15000, identity), candidates: cohort(CLOSE, identity) });
    expect(result).toMatchObject({ kind: 'ready', matchCount: 6, bounds: { targetFromTitle: ['make', 'model', 'transmission'], matchesFromTitle: 6 } });
  });

  test('duplicate IDs cannot inflate a reference cohort into a label', () => {
    const target = car(15000);
    const candidates = cohort([17000, 17500, 18000, 18500]);
    const first = candidates[0];
    if (!first) throw new Error('no candidate');
    expect(assessPrice({ target, candidates: [...candidates, first, { ...first, price: { kind: 'cash', eur: 19000 } }] })).toMatchObject({ kind: 'reference', exactCount: 4 });
  });

  test('keeps the inclusive fifteen percent boundaries', () => {
    const candidates = cohort([10000, 10000, 10000, 10000, 10000, 10000]);
    for (const [eur, label] of [[8500, 'great'], [8501, 'typical'], [11499, 'typical'], [11500, 'expensive']] as const) {
      expect(assessPrice({ target: car(eur), candidates })).toMatchObject({ kind: 'ready', label });
    }
  });

  test('labels a materially cheaper car as a great price against its close matches', () => {
    const target = car(15000);
    const result = assessPrice({ target, candidates: [target, ...cohort(CLOSE)] });
    expect(result).toMatchObject({ kind: 'ready', label: 'great', medianEur: 18250, matchCount: 6, targetEur: 15000 });
  });

  test('labels prices inside the band as typical and materially dearer ones as expensive', () => {
    const typical = car(18000);
    const expensive = car(21500);
    const candidates = [typical, expensive, ...cohort(CLOSE)];
    expect(assessPrice({ target: typical, candidates })).toMatchObject({ kind: 'ready', label: 'typical' });
    expect(assessPrice({ target: expensive, candidates })).toMatchObject({ kind: 'ready', label: 'expensive' });
  });

  test('returns up to five closest comparable references', () => {
    const target = car(15000);
    const result = assessPrice({ target, candidates: cohort(CLOSE) });
    if (result.kind !== 'ready') throw new Error(`expected ready, got ${result.kind}`);
    expect(result.comparables).toHaveLength(5);
    expect(result.comparables.every((comparable) => comparable.listingId !== target.listingId)).toBe(true);
  });

  test('abstains with fewer than five distinct close matches', () => {
    const target = car(15000);
    expect(assessPrice({ target, candidates: cohort([17000, 17500, 18000, 18500]) })).toMatchObject({
      kind: 'reference',
      why: 'few_matches',
      exactCount: 4,
      unknownFactCount: 0,
    });
  });

  test('counts a car listed twice once, and never compares a car with its own duplicate', () => {
    const target = car(15000, { mileage: { value: 91000, unit: 'km' } });
    const relisted = car(15000, { mileage: { value: 91000, unit: 'km' } });
    const twin = car(17000, { mileage: { value: 92000, unit: 'km' } });
    const twinAgain = car(17000, { mileage: { value: 92000, unit: 'km' } });
    const candidates = [target, relisted, twin, twinAgain, ...cohort([17500, 18000, 18500])];
    expect(assessPrice({ target, candidates })).toMatchObject({ kind: 'reference', why: 'few_matches', exactCount: 4 });
  });

  test('excludes mismatched, damaged and non-cash candidates', () => {
    const target = car(15000);
    const candidates = [
      ...cohort([17000, 17500, 18000, 18500]),
      car(18000, { transmission: 'automatic' }),
      car(18000, { sellerType: 'private' }),
      car(18000, { model: 'Polo' }),
      car(18000, { year: 2014 }),
      car(18000, { mileage: { value: 160000, unit: 'km' } }),
      car(18000, { engineLitres: 2 }),
      car(18000, { damageMentioned: true }),
      car(null),
      car(18000, { price: { kind: 'finance_only' } }),
    ];
    expect(assessPrice({ target, candidates })).toMatchObject({ kind: 'reference', why: 'few_matches', exactCount: 4 });
  });

  test('treats unknown matching facts as uncertainty, not as a match', () => {
    const target = car(15000);
    const candidates = [...cohort([17000, 17500, 18000, 18500]), ...cohort([18000, 18200], { transmission: null })];
    expect(assessPrice({ target, candidates })).toMatchObject({
      kind: 'reference',
      why: 'few_matches',
      exactCount: 4,
      partialCount: 2,
      unknownFactCount: 0,
    });
    expect(assessPrice({ target: car(15000, { transmission: null, sellerType: null }), candidates: cohort(CLOSE) })).toMatchObject({
      kind: 'reference', why: 'few_matches', exactCount: 0, partialCount: 6,
      comparables: expect.arrayContaining([expect.objectContaining({ unconfirmed: ['transmission', 'sellerType'] })]),
    });
  });

  test('converts miles before applying the mileage window', () => {
    const target = car(15000);
    const inMiles = cohort(CLOSE, { mileage: { value: 56000, unit: 'mi' } });
    expect(assessPrice({ target, candidates: inMiles })).toMatchObject({ kind: 'ready', label: 'great' });
  });

  test('abstains when asking prices are widely dispersed', () => {
    const target = car(15000);
    const candidates = cohort([10000, 12000, 18000, 24000, 30000, 31000]);
    expect(assessPrice({ target, candidates })).toMatchObject({ kind: 'reference', why: 'dispersed' });
  });

  test('abstains when removing one comparable changes the label', () => {
    const target = car(15300);
    const candidates = cohort([17000, 17500, 18000, 18500, 19000]);
    expect(assessPrice({ target, candidates })).toMatchObject({ kind: 'reference', why: 'unstable' });
  });

  test('has no price label for cars without a cash asking price or with damage mentioned', () => {
    const candidates = cohort(CLOSE);
    expect(assessPrice({ target: car(null), candidates })).toMatchObject({ reason: { code: 'no_cash_price' } });
    expect(assessPrice({ target: car(15000, { price: { kind: 'finance_only' } }), candidates })).toMatchObject({
      reason: { code: 'no_cash_price' },
    });
    expect(assessPrice({ target: car(300), candidates })).toMatchObject({ reason: { code: 'no_cash_price' } });
    expect(assessPrice({ target: car(9000, { damageMentioned: true }), candidates })).toMatchObject({
      reason: { code: 'damage_mentioned' },
    });
  });
});
