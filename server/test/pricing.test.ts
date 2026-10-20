import { describe, expect, test } from 'bun:test';
import type { ListingFacts } from '../../lib/contracts/listing';
import { facts } from '../../tests/support/listings';
import { assessPrice } from '../src/pricing';

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
    expect(assessPrice({ target, candidates: cohort([17000, 17500, 18000, 18500]) })).toEqual({
      kind: 'insufficient',
      reason: { code: 'too_few_matches' },
      matchCount: 4,
      unknownFactCount: 0,
    });
  });

  test('counts a car listed twice once, and never compares a car with its own duplicate', () => {
    const target = car(15000, { mileage: { value: 91000, unit: 'km' } });
    const relisted = car(15000, { mileage: { value: 91000, unit: 'km' } });
    const twin = car(17000, { mileage: { value: 92000, unit: 'km' } });
    const twinAgain = car(17000, { mileage: { value: 92000, unit: 'km' } });
    const candidates = [target, relisted, twin, twinAgain, ...cohort([17500, 18000, 18500])];
    expect(assessPrice({ target, candidates })).toMatchObject({ kind: 'insufficient', reason: { code: 'too_few_matches' }, matchCount: 4 });
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
    expect(assessPrice({ target, candidates })).toMatchObject({ kind: 'insufficient', reason: { code: 'too_few_matches' }, matchCount: 4 });
  });

  test('treats unknown matching facts as uncertainty, not as a match', () => {
    const target = car(15000);
    const candidates = [...cohort([17000, 17500, 18000, 18500]), ...cohort([18000, 18200], { transmission: null })];
    expect(assessPrice({ target, candidates })).toEqual({
      kind: 'insufficient',
      reason: { code: 'too_few_matches' },
      matchCount: 4,
      unknownFactCount: 2,
    });
    expect(assessPrice({ target: car(15000, { transmission: null, sellerType: null }), candidates: cohort(CLOSE) })).toMatchObject({
      kind: 'insufficient',
      reason: { code: 'unknown_facts', fields: ['transmission', 'sellerType'] },
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
    expect(assessPrice({ target, candidates })).toMatchObject({ kind: 'insufficient', reason: { code: 'dispersed' } });
  });

  test('abstains when removing one comparable changes the label', () => {
    const target = car(15300);
    const candidates = cohort([17000, 17500, 18000, 18500, 19000]);
    expect(assessPrice({ target, candidates })).toMatchObject({ kind: 'insufficient', reason: { code: 'unstable' } });
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
