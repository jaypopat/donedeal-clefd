import { expect, test } from 'bun:test';
import { facts } from '../../tests/support/listings';
import { factsAgree, samePriceIdentity } from './cache';

test('new material facts invalidate price reuse without breaking warning enrichment', () => {
  const base = facts({ id: '40000001', engineLitres: null, transmission: null });
  const enriched = facts({ id: base.listingId });
  expect(factsAgree(base, enriched)).toBe(true);
  expect(samePriceIdentity(base, enriched)).toBe(false);
  expect(samePriceIdentity(enriched, base)).toBe(true);
  expect(samePriceIdentity(base, { ...base })).toBe(true);
  expect(samePriceIdentity(base, { ...base, variant: { kind: 'marked', code: 'gti', source: 'trim' } })).toBe(false);
});

test('variant marker source can improve without changing price identity', () => {
  const title = facts({ id: '40000001', variant: { kind: 'marked', code: 'gti', source: 'title' } });
  expect(samePriceIdentity(title, { ...title, variant: { kind: 'marked', code: 'gti', source: 'trim' } })).toBe(true);
  expect(samePriceIdentity(title, { ...title, variant: { kind: 'marked', code: 'gtd', source: 'trim' } })).toBe(false);
});
