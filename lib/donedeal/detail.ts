import { z } from 'zod';
import type { ListingRef } from '../contracts/ids';
import type { AskingPrice, ListingFacts } from '../contracts/listing';
import { ListingFactsSchema } from '../contracts/listing';
import { LIMITS } from '../contracts/versions';
import type { RedactedText } from '../privacy/redact';
import { redact } from '../privacy/redact';
import { byClassPrefix, readNextData } from './dom';
import {
  cleanText,
  mentionsDamage,
  parseEngineLitres,
  parseFuel,
  parseHeadlinePrice,
  parseMileageText,
  parseSellerTypeCode,
  parseTransmission,
  parseYear,
} from './vocabulary';

const NextDetailSchema = z.object({
  props: z.object({
    pageProps: z.object({
      id: z.union([z.number().int(), z.string()]).transform(String),
      header: z.string().max(400).nullish(),
      description: z.string().max(40_000).nullish(),
      priceEuro: z.number().nullish(),
      priceOnRequest: z.boolean().nullish(),
      sellerType: z.string().nullish(),
      displayAttributes: z
        .array(z.object({ name: z.string(), value: z.union([z.string(), z.number()]).nullish() }))
        .nullish(),
    }),
  }),
});

export type DetailObservation = {
  anchor: Element;
  facts: ListingFacts;
  text: RedactedText;
  coverage: 'detail' | 'detail_partial';
};

function detailPrice(pageProps: z.infer<typeof NextDetailSchema>['props']['pageProps'], dom: string | null): AskingPrice {
  if (pageProps.priceOnRequest) return { kind: 'on_request' };
  const eur = pageProps.priceEuro;
  if (eur && Number.isInteger(eur) && eur > 0) return { kind: 'cash', eur };
  return parseHeadlinePrice(dom);
}

export function observeDetail(doc: Document, listing: ListingRef): DetailObservation | null {
  const parsed = NextDetailSchema.safeParse(readNextData(doc));
  if (!parsed.success) return null;
  const pageProps = parsed.data.props.pageProps;
  if (pageProps.id !== listing.id) return null;
  const priceElement = doc.querySelector(byClassPrefix('AdTitleBox-styled__Price-'));
  const anchor = doc.querySelector(byClassPrefix('AdTitleBox-styled__PriceRow-')) ?? priceElement;
  if (!anchor) return null;
  const attribute = (name: string) =>
    cleanText(String(pageProps.displayAttributes?.find((entry) => entry.name === name)?.value ?? ''));
  const header = cleanText(pageProps.header);
  const facts = ListingFactsSchema.safeParse({
    listingId: listing.id,
    url: listing.url,
    price: detailPrice(pageProps, priceElement?.textContent ?? null),
    year: parseYear(attribute('year')),
    mileage: parseMileageText(attribute('mileage')),
    make: attribute('make') || null,
    model: attribute('model') || null,
    fuel: parseFuel(attribute('fuelType')),
    transmission: parseTransmission(attribute('transmission')),
    sellerType: pageProps.sellerType ? parseSellerTypeCode(pageProps.sellerType) : null,
    engineLitres: parseEngineLitres(attribute('engine')),
    damageMentioned: mentionsDamage(header),
  });
  if (!facts.success) return null;
  const description = pageProps.description ?? '';
  const source = `${header}\n\n${description}`;
  const coverage = Array.from(source).length > LIMITS.maxTextCodepoints ? 'detail_partial' : 'detail';
  return { anchor, facts: facts.data, text: redact(source), coverage };
}
