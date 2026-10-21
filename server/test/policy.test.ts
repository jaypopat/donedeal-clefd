import { describe, expect, test } from 'bun:test';
import { facts } from '../../tests/support/listings';
import { findingsFrom } from '../src/warnings/policy';

describe('payment evidence policy', () => {
  test.each([
    'No viewing without a deposit.',
    'Cannot view without deposit',
    'Viewing not required, send €500 deposit to secure it.',
    'No refund required, pay the deposit before viewing.',
    'Deposit not refundable before viewing.',
    'No deposit refunds, pay before viewing.',
    'Pay the deposit before viewing without delay.',
  ])('keeps a payment demand when another proposition is negated: %s', (excerpt) => {
    expect(findingsFrom({
      facts: facts({ id: '42864633' }),
      claims: { payment_statement: { start: 0, end: Array.from(excerpt).length, excerpt } },
      judgements: { payment_before_viewing: 0.99 },
    })).toEqual([{
      reason: 'payment_before_viewing',
      evidence: [{ kind: 'text', start: 0, end: Array.from(excerpt).length, excerpt }],
    }]);
  });

  test.each([
    'No deposit needed before viewing',
    'No payment before viewing.',
    'A deposit is not required before viewing.',
    'Payment not needed to view the car.',
    'View without a deposit.',
    'Viewing is welcome without any payment.',
    "Don't send money before viewing.",
    'Do not pay before viewing.',
    'Never transfer money before inspection.',
    'A viewing is available, no deposit necessary.',
  ])('rejects a true no-payment proposition despite a yes judgement: %s', (excerpt) => {
    expect(findingsFrom({
      facts: facts({ id: '42864633' }),
      claims: { payment_statement: { start: 0, end: Array.from(excerpt).length, excerpt } },
      judgements: { payment_before_viewing: 0.99 },
    })).toEqual([]);
  });
});
