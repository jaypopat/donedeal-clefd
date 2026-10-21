import { expect, test } from 'bun:test';
import { facts } from '../../tests/support/listings';
import { findingsFrom } from '../src/warnings/policy';

test('only a structured gearbox can produce Listed gearbox evidence while payment checks stay independent', () => {
  const claims = {
    transmission_statement: { start: 0, end: 9, excerpt: 'Automatic' },
    payment_statement: { start: 10, end: 44, excerpt: 'Pay a deposit before viewing.' },
  };
  const run = (listing: ReturnType<typeof facts>) => findingsFrom({ facts: listing, claims, judgements: { payment_before_viewing: 0.99 } });
  expect(run(facts({ id: '40000001' })).map((finding) => finding.reason)).toEqual(['payment_before_viewing', 'transmission_mismatch']);
  for (const listing of [
    facts({ id: '40000001', titleEvidence: { recovered: ['transmission'], conflicts: [] } }),
    facts({ id: '40000001', searchEvidence: ['transmission'] }),
  ]) {
    const findings = run(listing);
    expect(findings.map((finding) => finding.reason)).toEqual(['payment_before_viewing']);
    expect(findings.flatMap((finding) => finding.evidence).some((evidence) => evidence.kind === 'field' && evidence.field === 'transmission')).toBe(false);
  }
});
