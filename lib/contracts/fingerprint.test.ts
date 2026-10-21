import { describe, expect, test } from 'bun:test';
import { canonicalJson, contentFingerprint, contextFingerprint, targetFingerprint } from './fingerprint';
import { facts } from '../../tests/support/listings';
import { redact } from '../privacy/redact';

describe('fingerprints', () => {
  test('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, 2] }, b: 1 }));
  });

  test('context fingerprint ignores candidate order but tracks facts and membership', async () => {
    const a = facts({ id: '40000001', eur: 10000 });
    const b = facts({ id: '40000002', eur: 11000 });
    const c = facts({ id: '40000003', eur: 12000 });
    const base = await contextFingerprint([a, b]);
    expect(await contextFingerprint([b, a])).toBe(base);
    expect(await contextFingerprint([a, facts({ id: '40000002', eur: 11500 })])).not.toBe(base);
    expect(await contextFingerprint([a, b, c])).not.toBe(base);
  });

  test('target fingerprint changes with any matching fact', async () => {
    const base = facts({ id: '40000001', eur: 10000 });
    const fp = await targetFingerprint(base);
    expect(await targetFingerprint({ ...base })).toBe(fp);
    expect(await targetFingerprint({ ...base, transmission: 'automatic' })).not.toBe(fp);
    expect(await targetFingerprint({ ...base, mileage: { value: 1, unit: 'km' } })).not.toBe(fp);
  });

  test('content fingerprint covers text and coverage', async () => {
    const listing = facts({ id: '40000001', eur: 10000 });
    const text = redact('Full service history');
    const fp = await contentFingerprint({ facts: listing, text, coverage: 'card' });
    expect(await contentFingerprint({ facts: listing, text, coverage: 'detail' })).not.toBe(fp);
    expect(await contentFingerprint({ facts: listing, text: redact('Partial service history'), coverage: 'card' })).not.toBe(fp);
  });

  test('all fingerprints track variant classification and evidence changes', async () => {
    const base = facts({ id: '40000001' });
    const variants = [
      facts({ id: base.listingId, variant: { kind: 'marked', code: 'gti', source: 'title' } }),
      facts({ id: base.listingId, variant: { kind: 'unmarked', source: 'trim' } }),
      facts({ id: base.listingId, titleEvidence: { recovered: ['transmission'], conflicts: [] } }),
      facts({ id: base.listingId, titleEvidence: { recovered: [], conflicts: ['transmission'] } }),
      facts({ id: base.listingId, titleEvidence: { recovered: [], conflicts: ['year'] } }),
      facts({ id: base.listingId, searchEvidence: ['make', 'model', 'transmission'] }),
    ];
    for (const changed of variants) {
      expect(await targetFingerprint(changed)).not.toBe(await targetFingerprint(base));
      expect(await contextFingerprint([changed])).not.toBe(await contextFingerprint([base]));
      expect(await contentFingerprint({ facts: changed, text: '', coverage: 'card' })).not.toBe(await contentFingerprint({ facts: base, text: '', coverage: 'card' }));
    }
  });
});
