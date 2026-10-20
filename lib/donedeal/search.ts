import { z } from 'zod';
import type { ListingId } from '../contracts/ids';
import { isListingId, parseListingHref } from '../contracts/ids';
import type { AskingPrice, ListingFacts, Mileage } from '../contracts/listing';
import { ListingFactsSchema } from '../contracts/listing';
import type { RedactedText } from '../privacy/redact';
import { redact } from '../privacy/redact';
import type { SearchFilters } from './page';
import { searchFilters } from './page';
import { byClassPrefix, readNextData } from './dom';
import {
  cleanText,
  mentionsDamage,
  parseEngineAndFuel,
  parseHeadlinePrice,
  parseMileageText,
  parseYear,
} from './vocabulary';

const SearchAdSchema = z.object({
  id: z.union([z.number().int(), z.string()]).transform(String),
  metaInfo: z.array(z.string()).nullish(),
  priceInfo: z
    .object({
      priceInEuro: z.number().nullish(),
      priceOnRequest: z.boolean().nullish(),
    })
    .nullish(),
  mileageInKm: z.number().int().nonnegative().nullish(),
  dealer: z.object({}).nullish(),
});
type SearchAd = z.infer<typeof SearchAdSchema>;

const NextSearchSchema = z.object({
  query: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  props: z.object({
    pageProps: z.object({
      ads: z.array(z.unknown()),
      initialMakeModels: z
        .array(z.object({ make: z.string().min(1).max(60), model: z.array(z.string().min(1).max(60)).nullish() }))
        .nullish(),
    }),
  }),
});

/** Structured search data, present only when the page's embedded data matches the current URL. */
export type SearchData = {
  filters: SearchFilters;
  ads: ReadonlyMap<ListingId, SearchAd>;
};

export type CardObservation = {
  element: Element;
  anchor: Element;
  facts: ListingFacts;
  text: RedactedText;
};

function queryMatchesLocation(query: Record<string, string | string[]>, location: URL, pathSegments: string[]): boolean {
  const section = query.section;
  const sectionPath = Array.isArray(section) ? section.join('/') : section;
  if (sectionPath?.toLowerCase() !== pathSegments.join('/').toLowerCase()) return false;
  const names = new Set(location.searchParams.keys());
  for (const name of names) {
    const fromUrl = location.searchParams.getAll(name);
    const fromData = query[name];
    const values = Array.isArray(fromData) ? fromData : fromData === undefined ? [] : [fromData];
    if (values.join('\u0000') !== fromUrl.join('\u0000')) return false;
  }
  return true;
}

export function readSearchData(input: {
  doc: Document;
  location: URL;
  params: URLSearchParams;
  pathSegments: string[];
}): SearchData | null {
  const parsed = NextSearchSchema.safeParse(readNextData(input.doc));
  if (!parsed.success) return null;
  if (!queryMatchesLocation(parsed.data.query, input.location, input.pathSegments)) return null;
  const ads = new Map<ListingId, SearchAd>();
  for (const raw of parsed.data.props.pageProps.ads) {
    const ad = SearchAdSchema.safeParse(raw);
    if (ad.success && isListingId(ad.data.id)) ads.set(ad.data.id, ad.data);
  }
  const makeModels = parsed.data.props.pageProps.initialMakeModels ?? [];
  const only = makeModels.length === 1 ? makeModels[0] : undefined;
  const pathMake = input.pathSegments[1]?.toLowerCase();
  const makeModel =
    only && only.make.toLowerCase() === pathMake
      ? { make: only.make, model: only.model?.length === 1 ? (only.model[0] ?? null) : null }
      : null;
  return { filters: searchFilters(input.params, makeModel), ads };
}

function cashFromAd(ad: SearchAd): AskingPrice | null {
  if (ad.priceInfo?.priceOnRequest) return { kind: 'on_request' };
  const eur = ad.priceInfo?.priceInEuro;
  return eur && Number.isInteger(eur) && eur > 0 ? { kind: 'cash', eur } : null;
}

type MetaFacts = Pick<ListingFacts, 'year' | 'mileage' | 'fuel' | 'engineLitres'>;

function parseMeta(items: readonly string[]): MetaFacts {
  const facts: MetaFacts = { year: null, mileage: null, fuel: null, engineLitres: null };
  for (const item of items) {
    const year = parseYear(item);
    if (year !== null && facts.year === null) {
      facts.year = year;
      continue;
    }
    const mileage = parseMileageText(item);
    if (mileage && facts.mileage === null) {
      facts.mileage = mileage;
      continue;
    }
    const engine = parseEngineAndFuel(item);
    if (engine && facts.fuel === null) {
      facts.fuel = engine.fuel;
      facts.engineLitres = engine.engineLitres;
    }
  }
  return facts;
}

/**
 * Reads one rendered result card. Promoted cards carry a `campaign` query and are
 * absent from the embedded search data, so they keep DOM-only facts and never
 * inherit the search's filter facts.
 */
function observeCard(element: Element, data: SearchData | null): CardObservation | null {
  const link = element.querySelector('a[href*="/cars-for-sale/"]');
  const href = link?.getAttribute('href');
  const ref = href ? parseListingHref(href) : null;
  if (!link || !href || !ref) return null;
  const promoted = new URL(href, 'https://www.donedeal.ie').searchParams.has('campaign');
  const ad = promoted ? undefined : data?.ads.get(ref.id);
  const title = cleanText(link.textContent);
  const priceElement = element.querySelector(byClassPrefix('Price-styled__Price-'));
  const anchor = element.querySelector(byClassPrefix('Price-styled__Wrapper-')) ?? priceElement;
  if (!anchor) return null;
  const meta = parseMeta(
    Array.from(element.querySelectorAll(byClassPrefix('SearchCard-styled__MetaInfoItem-')), (item) =>
      cleanText(item.textContent),
    ),
  );
  const headline = parseHeadlinePrice(priceElement?.textContent ?? null);
  const price = headline.kind === 'missing' && ad ? (cashFromAd(ad) ?? headline) : headline;
  const adKm = ad?.mileageInKm;
  const mileage: Mileage | null = typeof adKm === 'number' ? { value: adKm, unit: 'km' } : meta.mileage;
  const filters = !promoted && data ? data.filters : null;
  const sellerType = filters?.sellerType ?? (ad?.dealer ? 'dealer' : null);
  const facts = ListingFactsSchema.safeParse({
    listingId: ref.id,
    url: ref.url,
    price,
    year: meta.year,
    mileage,
    make: filters?.make ?? null,
    model: filters?.model ?? null,
    fuel: meta.fuel ?? filters?.fuel ?? null,
    transmission: filters?.transmission ?? null,
    sellerType,
    engineLitres: meta.engineLitres,
    damageMentioned: mentionsDamage(title),
  });
  if (!facts.success) return null;
  return { element, anchor, facts: facts.data, text: redact(title) };
}

export const CARD_SELECTOR = byClassPrefix('Card-styled__Container-');

export function observeCards(root: ParentNode, data: SearchData | null): CardObservation[] {
  const seen = new Set<ListingId>();
  const cards: CardObservation[] = [];
  for (const element of root.querySelectorAll(CARD_SELECTOR)) {
    const card = observeCard(element, data);
    if (!card || seen.has(card.facts.listingId)) continue;
    seen.add(card.facts.listingId);
    cards.push(card);
  }
  return cards;
}
