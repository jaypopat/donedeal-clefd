import { describe, expect, test } from 'bun:test';
import type { PriceResult, WarningResult } from '../contracts/assess';
import { parseListingHref } from '../contracts/ids';
import type { Coverage } from '../contracts/listing';
import { badgesFor, explain } from './explain';
import type { CardView, PriceView, WarningView } from './views';

const NOW = 1_792_000_000_000;
function listingRef() {
  const ref = parseListingHref('/cars-for-sale/example/42864633');
  if (!ref) throw new Error('bad ref');
  return ref;
}
const ref = listingRef();
const time = () => '14:32';

const great: PriceResult = {
  kind: 'ready',
  label: 'great',
  targetEur: 15000,
  medianEur: 18250,
  lowerQuartileEur: 17625,
  upperQuartileEur: 18875,
  deltaPercent: -17.8,
  matchCount: 6,
  unknownFactCount: 2,
  comparables: [],
};

function priced(result: PriceResult, scope: 'this_search' | 'originating_search' = 'this_search'): PriceView {
  return { kind: 'assessed', assessment: { result, scope, observedAt: NOW, sampleSize: 30, loadedCount: 30 } };
}

function checked(result: WarningResult, coverage: Coverage, reusedFromDetail = false): WarningView {
  return { kind: 'assessed', assessment: { result, coverage, observedAt: NOW, reusedFromDetail } };
}

function view(price: PriceView, warning: WarningView, coverage: Coverage = 'card'): CardView {
  return { listingId: ref.id, url: ref.url, coverage, price, warning };
}

const suspicious: WarningResult = {
  kind: 'checked',
  findings: [{ reason: 'payment_before_viewing', evidence: [{ kind: 'text', start: 0, end: 12, excerpt: 'Pay deposit first' }] }],
};

describe('badges', () => {
  test('price and warning signals stay independent', () => {
    expect(badgesFor(view(priced(great), checked(suspicious, 'card'))).map((badge) => badge.text)).toEqual(['Great price', 'Suspicious']);
    expect(badgesFor(view(priced(great), checked({ kind: 'checked', findings: [] }, 'card'))).map((badge) => badge.text)).toEqual([
      'Great price',
      'Limited info',
    ]);
  });

  test('a full listing with no findings shows no warning badge', () => {
    expect(badgesFor(view(priced(great), checked({ kind: 'checked', findings: [] }, 'detail'), 'detail')).map((badge) => badge.text)).toEqual([
      'Great price',
    ]);
  });

  test('pending and failed checks never read as a clean result', () => {
    expect(badgesFor(view({ kind: 'checking' }, { kind: 'checking' })).map((badge) => badge.text)).toEqual(['Checking']);
    const failed = checked({ kind: 'unavailable', error: 'model_error' }, 'detail');
    expect(badgesFor(view(priced(great), failed, 'detail')).map((badge) => badge.text)).toEqual(['Great price', 'Temporarily unavailable']);
    const both = view(priced({ kind: 'unavailable', error: 'service_unavailable' }), checked({ kind: 'unavailable', error: 'timeout' }, 'card'));
    expect(badgesFor(both).map((badge) => badge.text)).toEqual(['Temporarily unavailable']);
  });

  test('a direct detail visit has no price label', () => {
    expect(badgesFor(view({ kind: 'no_search_context' }, { kind: 'checking' }, 'detail')).map((badge) => badge.text)).toEqual([
      'Not enough data',
      'Checking',
    ]);
  });
});

describe('explanations', () => {
  test('limited detail text never claims a full or clean listing check', () => {
    const limited = view(priced(great), checked({ kind: 'checked', findings: [] }, 'detail_partial'), 'detail_partial');
    expect(badgesFor(limited).map((badge) => badge.text)).toContain('Limited info');
    const { warnings } = explain(limited, time);
    expect(warnings.coverage).toContain('4,000');
    expect(warnings.summary).toContain('full description');
    expect(JSON.stringify(warnings)).not.toMatch(/Full listing checked|No warning signs detected/);
  });

  test('price explanations are scoped to this search with count and sample time', () => {
    const { price } = explain(view(priced(great), checked({ kind: 'checked', findings: [] }, 'card')), time);
    expect(price.scope).toBe('Compared with this search · 6 close matches · sampled 14:32');
    expect(price.summary).toBe('Middle asking price €18,250. Middle half €17,625–€18,875.');
    expect(price.details).toContain('This car: €15,000, 17.8% below the middle.');
    expect(price.details).toContain('A price observation, not a recommendation to buy.');
    expect(price.details).toContain("2 loaded cars were left out because key details aren't shown.");
    expect(JSON.stringify(price)).not.toMatch(/market value|valuation/i);
  });

  test('a reused detail price keeps its originating search scope', () => {
    const { price } = explain(view(priced(great, 'originating_search'), { kind: 'checking' }, 'detail'), time);
    expect(price.scope).toContain('Compared with this search');
    expect(price.scope).toContain('from the results you opened this ad from');
  });

  test('missing card facts explain how to get a comparison', () => {
    const unknown: PriceResult = {
      kind: 'insufficient',
      reason: { code: 'unknown_facts', fields: ['transmission'] },
      matchCount: 0,
      unknownFactCount: 0,
    };
    const { price } = explain(view(priced(unknown), { kind: 'checking' }), time);
    expect(price.heading).toBe('Not enough data');
    expect(price.summary).toBe("This card doesn't show its transmission.");
    expect(price.details[0]).toBe('Filter the search by transmission to compare prices.');
  });

  test('findings use fixed templates with their evidence and a next step', () => {
    const { warnings } = explain(view(priced(great), checked(suspicious, 'card')), time);
    expect(warnings.heading).toBe('Suspicious');
    expect(warnings.findings).toEqual([
      {
        title: 'Payment requested before viewing',
        quotes: ['Pay deposit first'],
        fields: [],
        nextStep: 'Do not pay a deposit or transfer money before you have seen the car and its documents in person.',
      },
    ]);
    expect(warnings.coverage).toBe('Card info only · checked 14:32');
  });

  test('a clean full-listing check never claims the car is safe', () => {
    const { warnings } = explain(view(priced(great), checked({ kind: 'checked', findings: [] }, 'detail'), 'detail'), time);
    expect(warnings.summary).toContain('No warning signs detected in the information checked');
    expect(warnings.coverage).toBe('Full listing checked · 14:32');
    expect(JSON.stringify(warnings)).not.toMatch(/\b(safe|verified|not a scam)\b/i);
  });

  test('a failed check says it did not run', () => {
    const { warnings } = explain(view(priced(great), checked({ kind: 'unavailable', error: 'model_error' }, 'card')), time);
    expect(warnings.summary).toBe("Warning checks didn't run. This doesn't mean the listing passed.");
    expect(JSON.stringify(warnings)).not.toContain('No warning signs');
  });

  test('a reused detail check on a card shows when the evidence was seen', () => {
    const { warnings } = explain(view(priced(great), checked({ kind: 'checked', findings: [] }, 'detail', true)), time);
    expect(warnings.coverage).toBe("Full listing checked when you opened the ad at 14:32. Later edits to the ad won't show here.");
  });
});
