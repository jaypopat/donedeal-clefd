import { describe, expect, test } from 'bun:test';
import { mileageKm } from '../../lib/contracts/listing';
import { parseMileageText } from '../../lib/donedeal/vocabulary';
import { claimedKm } from '../src/warnings/policy';

describe('mileage parsing', () => {
  test('parses miles with mls abbreviation in vocabulary', () => {
    expect(parseMileageText('50,000 mls')).toEqual({ value: 50000, unit: 'mi' });
    expect(parseMileageText('50000mls')).toEqual({ value: 50000, unit: 'mi' });
    expect(parseMileageText('12,345 MLS')).toEqual({ value: 12345, unit: 'mi' });
  });

  test('parses normal mi, miles, km, and kms cases in vocabulary', () => {
    expect(parseMileageText('50,000 mi')).toEqual({ value: 50000, unit: 'mi' });
    expect(parseMileageText('50,000 miles')).toEqual({ value: 50000, unit: 'mi' });
    expect(parseMileageText('80,000 km')).toEqual({ value: 80000, unit: 'km' });
    expect(parseMileageText('80,000 kms')).toEqual({ value: 80000, unit: 'km' });
    expect(parseMileageText('invalid')).toBeNull();
  });

  test('extracts claimed km with mls abbreviation', () => {
    expect(claimedKm('Only 50,000 mls on the clock')).toBe(80467);
    expect(claimedKm('50,000mls')).toBe(80467);
    expect(claimedKm('50k mls')).toBe(80467);
  });

  test('converts mls consistently with mi, miles, and km cases', () => {
    const fromMls = claimedKm('50,000 mls');
    const fromMiles = claimedKm('50,000 miles');
    const fromMi = claimedKm('50,000 mi');
    expect(fromMls).toBe(fromMiles);
    expect(fromMls).toBe(fromMi);
    expect(claimedKm('80,000 km')).toBe(80000);
    expect(claimedKm('80,000 kilometres')).toBe(80000);

    const parsed = parseMileageText('50,000 mls');
    expect(parsed).not.toBeNull();
    if (parsed) {
      expect(mileageKm(parsed)).toBe(80467);
      expect(fromMls).not.toBeNull();
      expect(mileageKm(parsed)).toBe(fromMls as number);
    }
  });
});
