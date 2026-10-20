import { z } from 'zod';
import { PriceResultSchema, WarningResultSchema } from './contracts/assess';
import {
  ContentFpSchema,
  ContextFpSchema,
  ContextIdSchema,
  DocumentNonceSchema,
  EpochMsSchema,
  ListingIdSchema,
  TargetFpSchema,
} from './contracts/ids';
import { CoverageSchema, ListingFactsSchema, ListingTextSchema } from './contracts/listing';
import { LIMITS } from './contracts/versions';

export const PAGE_PORT = 'tyrekick-page';
const MAX_CARDS = 300;

export const PriceAssessmentSchema = z.strictObject({
  result: PriceResultSchema,
  scope: z.enum(['this_search', 'originating_search']),
  observedAt: EpochMsSchema,
  sampleSize: z.int().min(1).max(LIMITS.maxCandidates),
  loadedCount: z.int().min(1).max(MAX_CARDS),
});
export type PriceAssessment = z.infer<typeof PriceAssessmentSchema>;

export const WarningAssessmentSchema = z.strictObject({
  result: WarningResultSchema,
  coverage: CoverageSchema,
  observedAt: EpochMsSchema,
  reusedFromDetail: z.boolean(),
});
export type WarningAssessment = z.infer<typeof WarningAssessmentSchema>;

export const CardSyncSchema = z.strictObject({ facts: ListingFactsSchema, text: ListingTextSchema });
export type CardSync = z.infer<typeof CardSyncSchema>;

/** Cards in first-observed order. The first LIMITS.maxCandidates form the comparison sample. */
export const SearchSyncSchema = z
  .strictObject({
    kind: z.literal('search'),
    contextId: ContextIdSchema,
    observedAt: EpochMsSchema,
    cards: z.array(CardSyncSchema).min(1).max(MAX_CARDS),
    visible: z.array(ListingIdSchema).max(MAX_CARDS),
  })
  .refine((sync) => new Set(sync.cards.map((card) => card.facts.listingId)).size === sync.cards.length, {
    message: 'duplicate cards',
  });
export type SearchSync = z.infer<typeof SearchSyncSchema>;

export const DetailSyncSchema = z.strictObject({
  kind: z.literal('detail'),
  facts: ListingFactsSchema,
  text: ListingTextSchema,
  observedAt: EpochMsSchema,
});
export type DetailSync = z.infer<typeof DetailSyncSchema>;

export const OpeningSchema = z.strictObject({
  listingId: ListingIdSchema,
  contextId: ContextIdSchema,
  contextFp: ContextFpSchema,
  targetFp: TargetFpSchema,
});
export type Opening = z.infer<typeof OpeningSchema>;

export const PageMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('sync'),
    documentNonce: DocumentNonceSchema,
    page: z.discriminatedUnion('kind', [SearchSyncSchema, DetailSyncSchema]),
  }),
  z.strictObject({ type: z.literal('opened'), documentNonce: DocumentNonceSchema, opening: OpeningSchema }),
]);
export type PageMessage = z.infer<typeof PageMessageSchema>;

export const PriceDeliverySchema = z.strictObject({
  listingId: ListingIdSchema,
  targetFp: TargetFpSchema,
  context: z.strictObject({ contextId: ContextIdSchema, contextFp: ContextFpSchema }).nullable(),
  price: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('assessed'), assessment: PriceAssessmentSchema }),
    z.strictObject({ kind: z.literal('no_search_context') }),
  ]),
});
export type PriceDelivery = z.infer<typeof PriceDeliverySchema>;

export const WarningDeliverySchema = z.strictObject({
  listingId: ListingIdSchema,
  contentFp: ContentFpSchema,
  assessment: WarningAssessmentSchema,
});
export type WarningDelivery = z.infer<typeof WarningDeliverySchema>;

export const BackgroundMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('status'), active: z.boolean(), generation: z.int().min(0) }),
  z.strictObject({
    type: z.literal('price'),
    documentNonce: DocumentNonceSchema,
    deliveries: z.array(PriceDeliverySchema).max(MAX_CARDS),
  }),
  z.strictObject({
    type: z.literal('warning'),
    documentNonce: DocumentNonceSchema,
    deliveries: z.array(WarningDeliverySchema).max(MAX_CARDS),
  }),
]);
export type BackgroundMessage = z.infer<typeof BackgroundMessageSchema>;

export const PopupRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('get-state') }),
  z.strictObject({ type: z.literal('enable') }),
  z.strictObject({ type: z.literal('pause') }),
  z.strictObject({ type: z.literal('clear-data') }),
]);
export type PopupRequest = z.infer<typeof PopupRequestSchema>;
