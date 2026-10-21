import { z } from 'zod';
import type { ListingId } from '../contracts/ids';
import { isListingId, parseListingHref } from '../contracts/ids';
import type { AskingPrice, ListingFacts, Mileage, SearchField } from '../contracts/listing';
import { ListingFactsSchema } from '../contracts/listing';
import type { RedactedText } from '../privacy/redact';
import { redact } from '../privacy/redact';
import type { SearchFilters } from './page';
import { searchFilters } from './page';
import { byClassPrefix, readNextData } from './dom';
import { readIdentity } from './identity';
import {
  cleanText,
  mentionsDamage,
  parseEngineAndFuel,
  parseHeadlinePrice,
  parseMileageText,
  parseSellerTypeCode,
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
  seller: z.object({ type: z.string().nullish() }).nullish(),
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

function observeCard(element: Element, data: SearchData | null): CardObservation | null {
  const link = element.querySelector('a[href*="/cars-for-sale/"]');
  const href = link?.getAttribute('href');
  const ref = href ? parseListingHref(href) : null;
  if (!link || !href || !ref) return null;
  const promoted = new URL(href, 'https://www.donedeal.ie').searchParams.has('campaign');
  const ad = data?.ads.get(ref.id);
  const title = cleanText(link.textContent);
  const priceElement = element.querySelector(byClassPrefix('Price-styled__Price-'));
  const anchor = element.querySelector(byClassPrefix('Price-styled__Wrapper-')) ?? priceElement;
  if (!anchor) return null;
  const metaItems = Array.from(element.querySelectorAll(byClassPrefix('SearchCard-styled__MetaInfoItem-')), (item) => cleanText(item.textContent));
  const meta = parseMeta([...metaItems, ...(ad?.metaInfo ?? [])]);
  const headline = parseHeadlinePrice(priceElement?.textContent ?? null);
  const price = headline.kind === 'missing' && ad ? (cashFromAd(ad) ?? headline) : headline;
  const adKm = ad?.mileageInKm;
  const mileage: Mileage | null = typeof adKm === 'number' ? { value: adKm, unit: 'km' } : meta.mileage;
  const member = data !== null && (!promoted || ad !== undefined);
  const filters = member ? data.filters : null;
  const identity = readIdentity({
    title,
    listed: { make: filters?.make ?? null, model: filters?.model ?? null, transmission: filters?.transmission ?? null },
    corroborate: !member && data ? data.filters : null,
    trim: null,
  });
  const declaredSeller = ad?.seller?.type ? parseSellerTypeCode(ad.seller.type) : null;
  const sellerType = declaredSeller === 'private' && ad?.dealer
    ? null
    : declaredSeller ?? (ad?.dealer ? 'dealer' : filters?.sellerType ?? null);
  const searchEvidence: SearchField[] = [];
  if (filters?.make) searchEvidence.push('make');
  if (filters?.model) searchEvidence.push('model');
  if (filters?.transmission) searchEvidence.push('transmission');
  if (meta.fuel === null && filters?.fuel) searchEvidence.push('fuel');
  if (sellerType !== null && !declaredSeller && !ad?.dealer && filters?.sellerType) searchEvidence.push('sellerType');
  const facts = ListingFactsSchema.safeParse({
    listingId: ref.id,
    url: ref.url,
    price,
    year: meta.year,
    mileage,
    ...identity,
    searchEvidence: searchEvidence.sort(),
    fuel: meta.fuel ?? filters?.fuel ?? null,
    sellerType,
    engineLitres: meta.engineLitres,
    damageMentioned: mentionsDamage(title),
  });
  if (!facts.success) return null;
  return { element, anchor, facts: facts.data, text: redact(title) };
}

export const CARD_SELECTOR = byClassPrefix('Card-styled__Container-');

export function observeCards(root: ParentNode, data: SearchData | null): CardObservation[] {
  const cards = new Map<ListingId, CardObservation>();
  for (const element of root.querySelectorAll(CARD_SELECTOR)) {
    const card = observeCard(element, data);
    if (!card) continue;
    const existing = cards.get(card.facts.listingId);
    const href = element.querySelector('a[href*="/cars-for-sale/"]')?.getAttribute('href');
    const promoted = href ? new URL(href, 'https://www.donedeal.ie').searchParams.has('campaign') : false;
    if (!existing || !promoted) cards.set(card.facts.listingId, card);
  }
  return [...cards.values()];
}
