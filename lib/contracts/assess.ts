import { z } from 'zod';
import { ASSESS_SCHEMA_VERSION, LIMITS, POLICY } from './versions';
import {
  ContentFpSchema,
  ContextFpSchema,
  ContextIdSchema,
  EpochMsSchema,
  ListingIdSchema,
  ListingUrlSchema,
  TargetFpSchema,
} from './ids';
import { CoverageSchema, ListingFactsSchema, ListingTextSchema } from './listing';

export const PolicySchema = z.strictObject({
  pricing: z.literal(POLICY.pricing),
  warnings: z.literal(POLICY.warnings),
  privacy: z.literal(POLICY.privacy),
});

export const PriceWorkSchema = z
  .strictObject({
    contextId: ContextIdSchema,
    observedAt: EpochMsSchema,
    loadedCount: z.int().min(1).max(10_000),
    candidates: z.array(ListingFactsSchema).min(1).max(LIMITS.maxCandidates),
    targetIds: z.array(ListingIdSchema).min(1).max(LIMITS.maxTargetsPerRequest),
  })
  .superRefine((work, ctx) => {
    const ids = new Set(work.candidates.map((candidate) => candidate.listingId));
    if (ids.size !== work.candidates.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate candidate ids', path: ['candidates'] });
    }
    if (new Set(work.targetIds).size !== work.targetIds.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate target ids', path: ['targetIds'] });
    }
    if (work.targetIds.some((id) => !ids.has(id))) {
      ctx.addIssue({ code: 'custom', message: 'target is not a candidate', path: ['targetIds'] });
    }
    if (work.loadedCount < work.candidates.length) {
      ctx.addIssue({ code: 'custom', message: 'loadedCount below candidate count', path: ['loadedCount'] });
    }
  });
export type PriceWork = z.infer<typeof PriceWorkSchema>;

export const WarningTargetSchema = z.strictObject({
  facts: ListingFactsSchema,
  coverage: CoverageSchema,
  text: ListingTextSchema,
  observedAt: EpochMsSchema,
});
export type WarningTarget = z.infer<typeof WarningTargetSchema>;

export const WarningWorkSchema = z
  .strictObject({
    targets: z.array(WarningTargetSchema).min(1).max(LIMITS.maxTargetsPerRequest),
  })
  .superRefine((work, ctx) => {
    const ids = work.targets.map((target) => target.facts.listingId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate warning targets', path: ['targets'] });
    }
  });
export type WarningWork = z.infer<typeof WarningWorkSchema>;

export const AssessRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(ASSESS_SCHEMA_VERSION),
    requestId: z.uuid(),
    policy: PolicySchema,
    price: PriceWorkSchema.nullable(),
    warnings: WarningWorkSchema.nullable(),
  })
  .superRefine((request, ctx) => {
    if (!request.price && !request.warnings) {
      ctx.addIssue({ code: 'custom', message: 'no branch requested' });
    }
    const targets = new Set([
      ...(request.price?.targetIds ?? []),
      ...(request.warnings?.targets.map((target) => target.facts.listingId) ?? []),
    ]);
    if (targets.size > LIMITS.maxTargetsPerRequest) {
      ctx.addIssue({ code: 'custom', message: 'too many targets' });
    }
  });
export type AssessRequest = z.infer<typeof AssessRequestSchema>;

export const BranchErrorSchema = z.enum([
  'service_unavailable',
  'model_error',
  'model_invalid_output',
  'timeout',
  'internal',
  'invalid_response',
]);
export type BranchError = z.infer<typeof BranchErrorSchema>;

export const EssentialFieldSchema = z.enum([
  'make',
  'model',
  'year',
  'mileage',
  'fuel',
  'transmission',
  'sellerType',
]);
export type EssentialField = z.infer<typeof EssentialFieldSchema>;

export const InsufficientReasonSchema = z.discriminatedUnion('code', [
  z.strictObject({ code: z.literal('non_cash_price') }),
  z.strictObject({
    code: z.literal('unknown_facts'),
    fields: z.tuple([EssentialFieldSchema], EssentialFieldSchema),
  }),
  z.strictObject({ code: z.literal('too_few_matches') }),
  z.strictObject({ code: z.literal('dispersed') }),
  z.strictObject({ code: z.literal('unstable') }),
]);
export type InsufficientReason = z.infer<typeof InsufficientReasonSchema>;

export const PriceLabelSchema = z.enum(['great', 'typical', 'expensive']);
export type PriceLabel = z.infer<typeof PriceLabelSchema>;

const Eur = z.int().min(0).max(5_000_000);

export const ComparableSchema = z.strictObject({
  listingId: ListingIdSchema,
  url: ListingUrlSchema,
  priceEur: Eur,
  year: z.int(),
  mileageKm: z.int().min(0),
});
export type Comparable = z.infer<typeof ComparableSchema>;

export const PriceResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ready'),
    label: PriceLabelSchema,
    targetEur: Eur,
    medianEur: Eur,
    lowerQuartileEur: Eur,
    upperQuartileEur: Eur,
    deltaPercent: z.number().min(-100).max(10_000),
    matchCount: z.int().min(1),
    unknownFactCount: z.int().min(0),
    comparables: z.array(ComparableSchema).max(LIMITS.maxComparables),
  }),
  z.strictObject({
    kind: z.literal('insufficient'),
    reason: InsufficientReasonSchema,
    matchCount: z.int().min(0),
    unknownFactCount: z.int().min(0),
  }),
  z.strictObject({ kind: z.literal('unavailable'), error: BranchErrorSchema }),
]);
export type PriceResult = z.infer<typeof PriceResultSchema>;

export const ReasonCodeSchema = z.enum([
  'payment_before_viewing',
  'shipping_only',
  'mileage_mismatch',
  'year_mismatch',
  'fuel_mismatch',
  'transmission_mismatch',
  'private_seller_business_wording',
  'service_history_conflict',
]);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

export const FieldEvidenceNameSchema = z.enum(['mileage', 'year', 'fuel', 'transmission', 'sellerType']);
export type FieldEvidenceName = z.infer<typeof FieldEvidenceNameSchema>;

export const EvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('text'),
    start: z.int().min(0),
    end: z.int().min(1),
    excerpt: z.string().min(1).max(LIMITS.maxExcerptCodepoints * 2),
  }),
  z.strictObject({
    kind: z.literal('field'),
    field: FieldEvidenceNameSchema,
    value: z.string().min(1).max(60),
  }),
]);
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FindingSchema = z.strictObject({
  reason: ReasonCodeSchema,
  evidence: z.tuple([EvidenceSchema], EvidenceSchema),
});
export type Finding = z.infer<typeof FindingSchema>;

export const WarningResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('checked'),
    findings: z.array(FindingSchema).max(LIMITS.maxFindings),
  }),
  z.strictObject({ kind: z.literal('unavailable'), error: BranchErrorSchema }),
]);
export type WarningResult = z.infer<typeof WarningResultSchema>;

export const PriceTargetResultSchema = z.strictObject({
  listingId: ListingIdSchema,
  targetFp: TargetFpSchema,
  result: PriceResultSchema,
});
export type PriceTargetResult = z.infer<typeof PriceTargetResultSchema>;

export const WarningTargetResultSchema = z.strictObject({
  listingId: ListingIdSchema,
  contentFp: ContentFpSchema,
  coverage: CoverageSchema,
  observedAt: EpochMsSchema,
  result: WarningResultSchema,
});
export type WarningTargetResult = z.infer<typeof WarningTargetResultSchema>;

export const AssessResponseSchema = z.strictObject({
  schemaVersion: z.literal(ASSESS_SCHEMA_VERSION),
  requestId: z.uuid(),
  policy: PolicySchema,
  assessedAt: EpochMsSchema,
  price: z
    .strictObject({
      contextId: ContextIdSchema,
      contextFp: ContextFpSchema,
      observedAt: EpochMsSchema,
      results: z.array(PriceTargetResultSchema),
    })
    .nullable(),
  warnings: z.strictObject({ results: z.array(WarningTargetResultSchema) }).nullable(),
});
export type AssessResponse = z.infer<typeof AssessResponseSchema>;

export const ApiErrorCodeSchema = z.enum([
  'access_not_configured',
  'forbidden_origin',
  'not_found',
  'method_not_allowed',
  'unsupported_media_type',
  'payload_too_large',
  'invalid_json',
  'invalid_request',
  'version_mismatch',
  'internal',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.strictObject({
  error: ApiErrorCodeSchema,
  issues: z.array(z.string()).optional(),
});
