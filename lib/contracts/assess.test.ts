import { describe, expect, test } from 'bun:test';
import { AssessRequestSchema, FindingSchema } from './assess';
import { ASSESS_SCHEMA_VERSION, POLICY } from './versions';
import { ListingFactsSchema } from './listing';
import { facts } from '../../tests/support/listings';
import { redact } from '../privacy/redact';

const NOW = 1_792_000_000_000;

function request(overrides: Record<string, unknown> = {}) {
  const candidates = [facts({ id: '40000001' }), facts({ id: '40000002' })];
  return {
    schemaVersion: ASSESS_SCHEMA_VERSION,
    requestId: crypto.randomUUID(),
    policy: POLICY,
    price: {
      contextId: crypto.randomUUID(),
      observedAt: NOW,
      loadedCount: 2,
      candidates,
      targetIds: ['40000001'],
    },
    warnings: { targets: [{ facts: candidates[0], coverage: 'card', text: redact('Low mileage'), observedAt: NOW }] },
    ...overrides,
  };
}

function issues(input: unknown): string[] {
  const parsed = AssessRequestSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe('assessment request contract', () => {
  test('accepts a well-formed request', () => {
    expect(issues(request())).toEqual([]);
  });

  test('rejects a listing whose URL names a different id', () => {
    const listing = { ...facts({ id: '40000001' }), url: 'https://www.donedeal.ie/cars-for-sale/x/40000009' };
    expect(ListingFactsSchema.safeParse(listing).success).toBe(false);
  });

  test('rejects non-canonical listing URLs', () => {
    for (const url of [
      'http://www.donedeal.ie/cars-for-sale/x/40000001',
      'https://donedeal.ie/cars-for-sale/x/40000001',
      'https://www.donedeal.ie/cars-for-sale/x/40000001?campaign=3',
      'https://www.donedeal.ie.evil.example/cars-for-sale/x/40000001',
    ]) {
      expect(ListingFactsSchema.safeParse({ ...facts({ id: '40000001' }), url }).success).toBe(false);
    }
  });

  test('rejects targets outside the comparison context and duplicate candidates', () => {
    const base = request();
    expect(issues({ ...base, price: { ...base.price, targetIds: ['40000003'] } })).toContain('target is not a candidate');
    const duplicate = [...base.price.candidates, facts({ id: '40000001' })];
    expect(issues({ ...base, price: { ...base.price, candidates: duplicate, loadedCount: 3 } })).toContain(
      'duplicate candidate ids',
    );
  });

  test('bounds candidates and combined targets', () => {
    const base = request();
    const many = Array.from({ length: 101 }, (_, index) => facts({ id: String(40000000 + index) }));
    expect(issues({ ...base, price: { ...base.price, candidates: many, loadedCount: 101 } }).length).toBeGreaterThan(0);
    const targets = Array.from({ length: 21 }, (_, index) => ({
      facts: facts({ id: String(50000000 + index) }),
      coverage: 'card',
      text: redact(''),
      observedAt: NOW,
    }));
    expect(issues({ ...base, price: null, warnings: { targets } }).length).toBeGreaterThan(0);
    const priceTargets = base.price.candidates.map((candidate) => candidate.listingId);
    const warningTargets = targets.slice(0, 19);
    expect(
      issues({ ...base, price: { ...base.price, targetIds: priceTargets }, warnings: { targets: warningTargets } }),
    ).toContain('too many targets');
  });

  test('rejects text that was not redacted and requests with no branch', () => {
    const base = request();
    const target = { ...base.warnings.targets[0], text: 'Call 087 123 4567' };
    expect(issues({ ...base, warnings: { targets: [target] } })).toContain('text is not redacted');
    expect(issues({ ...base, price: null, warnings: null })).toContain('no branch requested');
  });

  test('rejects mismatched policy versions', () => {
    expect(issues(request({ policy: { ...POLICY, pricing: 'pricing.old' } })).length).toBeGreaterThan(0);
  });

  test('a finding cannot exist without evidence', () => {
    expect(FindingSchema.safeParse({ reason: 'mileage_mismatch', evidence: [] }).success).toBe(false);
  });
});
