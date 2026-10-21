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

describe('mileage evidence policy', () => {
  test.each([
    'Timing belt and service done at 60,000km',
    'new tyres fitted at 52,000 km',
    'Timing belt changed at 60k miles.',
    'Last serviced at 60,000 km.',
    '60,000km service completed.',
    'Timing belt at 60,000 km.',
    'Oil and filter replaced at 52,000km.',
    'Clutch replaced at 40k mls, timing belt done at 60,000km.',
  ])('does not treat a maintenance distance as the current odometer: %s', (excerpt) => {
    expect(findingsFrom({
      facts: facts({ id: '42864633', mileage: { value: 90000, unit: 'km' } }),
      claims: { mileage_statement: { start: 0, end: Array.from(excerpt).length, excerpt } },
      judgements: {},
    })).toEqual([]);
  });

  test.each([
    'only40k mls on the clock',
    'Mileage60000km',
    'The car has covered 60,000 km.',
    '60,000 km with full service history.',
    'Full service history, only40k mls on the clock.',
    'New tyres fitted, mileage60000km.',
    'Timing belt and service done, currently 60,000km.',
    'Timing belt done at 90,000km, now on 60,000km.',
    'Timing belt done at 90,000km. Mileage60000km.',
    'Mileage 60,000km, service completed last week.',
    'Mileage60000km service completed.',
    'The car has covered 60,000km service done.',
  ])('keeps actual odometer assertions alongside maintenance words: %s', (excerpt) => {
    expect(findingsFrom({
      facts: facts({ id: '42864633', mileage: { value: 90000, unit: 'km' } }),
      claims: { mileage_statement: { start: 0, end: Array.from(excerpt).length, excerpt } },
      judgements: {},
    })).toEqual([{
      reason: 'mileage_mismatch',
      evidence: [
        { kind: 'text', start: 0, end: Array.from(excerpt).length, excerpt },
        { kind: 'field', field: 'mileage', value: '90,000 km' },
      ],
    }]);
  });

  test.each([
    ['only40k mls on the clock', 64374],
    ['Mileage60000km', 60000],
    ['60,000 miles with full service history.', 96561],
    ['Timing belt done at 40,000km, now on 90,000 km.', 90000],
  ])('compares current distances after units conversion: %s', (excerpt, value) => {
    expect(findingsFrom({
      facts: facts({ id: '42864633', mileage: { value, unit: 'km' } }),
      claims: { mileage_statement: { start: 0, end: Array.from(excerpt).length, excerpt } },
      judgements: {},
    })).toEqual([]);
  });
});
