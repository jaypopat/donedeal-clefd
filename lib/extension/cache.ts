import { z } from 'zod';
import { SettledPriceResultSchema, WarningCheckedSchema } from '../contracts/assess';
import type { ContentFp, ContextFp, ListingId, TargetFp } from '../contracts/ids';
import {
  ContentFpSchema,
  ContextFpSchema,
  ContextIdSchema,
  EpochMsSchema,
  ListingIdSchema,
  TargetFpSchema,
} from '../contracts/ids';
import type { Coverage, ListingFacts } from '../contracts/listing';
import { ListingFactsSchema, mileageKm } from '../contracts/listing';
import { LIMITS, POLICY } from '../contracts/versions';
import { PriceAssessmentSchema, WarningAssessmentSchema } from '../messages';

export const PriceEntrySchema = z.strictObject({
  branch: z.literal('price'),
  key: z.string(),
  listingId: ListingIdSchema,
  storedAt: EpochMsSchema,
  facts: ListingFactsSchema,
  context: z.strictObject({ contextId: ContextIdSchema, contextFp: ContextFpSchema }),
  targetFp: TargetFpSchema,
  assessment: PriceAssessmentSchema.extend({ result: SettledPriceResultSchema }),
});
export type PriceEntry = z.infer<typeof PriceEntrySchema>;

export const WarningEntrySchema = z.strictObject({
  branch: z.literal('warning'),
  key: z.string(),
  listingId: ListingIdSchema,
  storedAt: EpochMsSchema,
  facts: ListingFactsSchema,
  contentFp: ContentFpSchema,
  assessment: WarningAssessmentSchema.extend({ result: WarningCheckedSchema }),
});
export type WarningEntry = z.infer<typeof WarningEntrySchema>;

export type CacheEntry = PriceEntry | WarningEntry;

/** Price and warning results share one bound but never one key. */
export const CacheSchema = z.strictObject({
  version: z.literal(1),
  generation: z.int().min(0),
  entries: z.array(z.discriminatedUnion('branch', [PriceEntrySchema, WarningEntrySchema])).max(LIMITS.maxCachedAssessments),
});
export type Cache = z.infer<typeof CacheSchema>;

export function emptyCache(generation: number): Cache {
  return { version: 1, generation, entries: [] };
}

export function priceKey(input: { listingId: ListingId; targetFp: TargetFp; contextFp: ContextFp }): string {
  return ['price', input.listingId, input.targetFp, input.contextFp, POLICY.pricing].join('|');
}

export function warningKey(input: { listingId: ListingId; contentFp: ContentFp; coverage: Coverage }): string {
  return ['warning', input.listingId, input.contentFp, input.coverage, POLICY.warnings, POLICY.privacy].join('|');
}

function isFresh(entry: CacheEntry, now: number): boolean {
  return now - entry.storedAt < LIMITS.assessmentTtlMs && entry.storedAt <= now;
}

export function pruneCache(cache: Cache, now: number): Cache {
  return { ...cache, entries: cache.entries.filter((entry) => isFresh(entry, now)) };
}

export function withEntry(cache: Cache, entry: CacheEntry, now: number): Cache {
  const kept = cache.entries.filter((existing) => existing.key !== entry.key && isFresh(existing, now));
  const entries = [...kept, entry].sort((a, b) => a.storedAt - b.storedAt).slice(-LIMITS.maxCachedAssessments);
  return { ...cache, entries };
}

export function findPrice(cache: Cache, key: string, now: number): PriceEntry | null {
  const entry = cache.entries.find((candidate) => candidate.key === key);
  return entry?.branch === 'price' && isFresh(entry, now) ? entry : null;
}

export function findWarning(cache: Cache, key: string, now: number): WarningEntry | null {
  const entry = cache.entries.find((candidate) => candidate.key === key);
  return entry?.branch === 'warning' && isFresh(entry, now) ? entry : null;
}

function sameText(a: string | null, b: string | null): boolean {
  return a === null || b === null || a.trim().toLowerCase() === b.trim().toLowerCase();
}

function same<T>(a: T | null, b: T | null): boolean {
  return a === null || b === null || a === b;
}

/**
 * True when every fact known on both sides agrees. A detail page knows more than a
 * card, so extra known fields must not count as disagreement.
 */
export function factsAgree(a: ListingFacts, b: ListingFacts): boolean {
  if (a.listingId !== b.listingId) return false;
  const priceAgrees =
    a.price.kind === 'missing' ||
    b.price.kind === 'missing' ||
    (a.price.kind === 'cash' && b.price.kind === 'cash' ? a.price.eur === b.price.eur : a.price.kind === b.price.kind);
  const mileageAgrees = !a.mileage || !b.mileage || Math.abs(mileageKm(a.mileage) - mileageKm(b.mileage)) <= 1;
  const engineAgrees = a.engineLitres === null || b.engineLitres === null || Math.abs(a.engineLitres - b.engineLitres) < 0.05;
  return (
    priceAgrees &&
    mileageAgrees &&
    engineAgrees &&
    a.damageMentioned === b.damageMentioned &&
    same(a.year, b.year) &&
    sameText(a.make, b.make) &&
    sameText(a.model, b.model) &&
    same(a.fuel, b.fuel) &&
    same(a.transmission, b.transmission) &&
    same(a.sellerType, b.sellerType)
  );
}

/** A recent full-listing check that may enrich a card whose visible facts still agree. */
export function freshDetailWarning(cache: Cache, card: ListingFacts, now: number): WarningEntry | null {
  const matches = cache.entries.filter(
    (entry): entry is WarningEntry =>
      entry.branch === 'warning' &&
      entry.listingId === card.listingId &&
      entry.assessment.coverage === 'detail' &&
      isFresh(entry, now) &&
      now - entry.assessment.observedAt <= LIMITS.detailReuseMs &&
      factsAgree(entry.facts, card),
  );
  return matches.sort((a, b) => b.assessment.observedAt - a.assessment.observedAt)[0] ?? null;
}
