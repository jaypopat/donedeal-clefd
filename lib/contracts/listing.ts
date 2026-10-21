import { z } from 'zod';
import { isRedactedText, type RedactedText } from '../privacy/redact';
import { ListingIdSchema, ListingUrlSchema, listingIdOfUrl } from './ids';

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
  })
  .refine((facts) => listingIdOfUrl(facts.url) === facts.listingId, {
    message: 'listing url and id disagree',
    path: ['url'],
  });
export type ListingFacts = z.infer<typeof ListingFactsSchema>;

/** Redacted, length-limited listing text. Offsets into it are Unicode codepoints. */
export const ListingTextSchema = z.custom<RedactedText>(isRedactedText, { message: 'text is not redacted' });

export function mileageKm(mileage: Mileage): number {
  return mileage.unit === 'km' ? mileage.value : Math.round(mileage.value * 1.609344);
}
