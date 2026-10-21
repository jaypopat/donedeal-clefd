import { z } from 'zod';
import { isRedactedText, type RedactedText } from '../privacy/redact';
import { ListingIdSchema, ListingUrlSchema, listingIdOfUrl } from './ids';
import { VariantCodeSchema, variantsFor } from './variants';

export const AskingPriceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('cash'), eur: z.int().min(1).max(5_000_000) }),
  z.strictObject({ kind: z.literal('finance_only') }),
  z.strictObject({ kind: z.literal('on_request') }),
  z.strictObject({ kind: z.literal('missing') }),
]);
export type AskingPrice = z.infer<typeof AskingPriceSchema>;

export const MileageSchema = z.strictObject({
  value: z.int().min(0).max(2_000_000),
  unit: z.enum(['km', 'mi']),
});
export type Mileage = z.infer<typeof MileageSchema>;

export const FuelSchema = z.enum([
  'petrol',
  'diesel',
  'electric',
  'petrol_hybrid',
  'diesel_hybrid',
  'petrol_plugin_hybrid',
  'diesel_plugin_hybrid',
]);
export type Fuel = z.infer<typeof FuelSchema>;

export const TransmissionSchema = z.enum(['manual', 'automatic']);
export type Transmission = z.infer<typeof TransmissionSchema>;

export const SellerTypeSchema = z.enum(['dealer', 'private']);
export type SellerType = z.infer<typeof SellerTypeSchema>;

export const CoverageSchema = z.enum(['card', 'detail', 'detail_partial']);
export type Coverage = z.infer<typeof CoverageSchema>;

const DisplayName = z.string().trim().min(1).max(60);

export const TitleFieldSchema = z.enum(['make', 'model', 'transmission']);
export type TitleField = z.infer<typeof TitleFieldSchema>;
export const SearchFieldSchema = z.enum(['make', 'model', 'fuel', 'transmission', 'sellerType']);
export type SearchField = z.infer<typeof SearchFieldSchema>;
export const VariantSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('marked'), code: VariantCodeSchema, source: z.enum(['title', 'trim']) }),
  z.strictObject({ kind: z.literal('unmarked'), source: z.enum(['title', 'trim']) }),
  z.strictObject({ kind: z.literal('ambiguous') }),
  z.strictObject({ kind: z.literal('not_catalogued') }),
]);
export type Variant = z.infer<typeof VariantSchema>;

/**
 * Allowlisted vehicle facts. `null` means the page did not evidence the fact.
 * Nothing here identifies a seller, a plate, or a VIN.
 */
export const ListingFactsSchema = z
  .strictObject({
    listingId: ListingIdSchema,
    url: ListingUrlSchema,
    price: AskingPriceSchema,
    year: z.int().min(1900).max(2100).nullable(),
    mileage: MileageSchema.nullable(),
    make: DisplayName.nullable(),
    model: DisplayName.nullable(),
    fuel: FuelSchema.nullable(),
    transmission: TransmissionSchema.nullable(),
    sellerType: SellerTypeSchema.nullable(),
    engineLitres: z.number().min(0.5).max(10).nullable(),
    damageMentioned: z.boolean(),
    variant: VariantSchema,
    titleEvidence: z.strictObject({
      recovered: z.array(TitleFieldSchema).max(3),
      conflicts: z.array(TitleFieldSchema).max(3),
    }),
    searchEvidence: z.array(SearchFieldSchema).max(5),
  })
  .refine((facts) => listingIdOfUrl(facts.url) === facts.listingId, {
    message: 'listing url and id disagree',
    path: ['url'],
  })
  .superRefine((facts, ctx) => {
    const { recovered, conflicts } = facts.titleEvidence;
    for (const fields of [recovered, conflicts, facts.searchEvidence]) {
      if (fields.join('|') !== [...new Set(fields)].sort().join('|') || fields.some((field) => facts[field] === null)) {
        ctx.addIssue({ code: 'custom', message: 'evidence fields must be known, sorted and unique' });
      }
    }
    if (recovered.some((field) => conflicts.includes(field) || facts.searchEvidence.includes(field))) {
      ctx.addIssue({ code: 'custom', message: 'title recovery cannot also be conflicting or search-derived' });
    }
    const codes = variantsFor(facts.make, facts.model);
    const variant = facts.variant;
    if ((codes.length === 0) !== (variant.kind === 'not_catalogued') ||
        (variant.kind === 'marked' && !codes.includes(variant.code))) {
      ctx.addIssue({ code: 'custom', message: 'variant does not belong to this make/model', path: ['variant'] });
    }
  });
export type ListingFacts = z.infer<typeof ListingFactsSchema>;

/** Redacted, length-limited listing text. Offsets into it are Unicode codepoints. */
export const ListingTextSchema = z.custom<RedactedText>(isRedactedText, { message: 'text is not redacted' });

export function mileageKm(mileage: Mileage): number {
  return mileage.unit === 'km' ? mileage.value : Math.round(mileage.value * 1.609344);
}
