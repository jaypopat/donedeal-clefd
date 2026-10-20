import type { ListingRef } from '../contracts/ids';
import { parseListingHref } from '../contracts/ids';
import type { Fuel, SellerType, Transmission } from '../contracts/listing';
import { parseFuel, parseSellerTypeCode, parseTransmission } from './vocabulary';

/** Normalised search path plus filter/sort/paging parameters. A new key is a new comparison context. */
export type SearchKey = string & { readonly __brand: 'SearchKey' };

/** Facts every organic result in this search shares because the search filters them. */
export type SearchFilters = {
  make: string | null;
  model: string | null;
  transmission: Transmission | null;
  fuel: Fuel | null;
  sellerType: SellerType | null;
};

export type PageRoute =
  | { kind: 'search'; searchKey: SearchKey; params: URLSearchParams; pathSegments: string[] }
  | { kind: 'detail'; listing: ListingRef }
  | { kind: 'unsupported' };

const TRACKING_PARAMS = /^(utm_.*|gclid|fbclid|campaign|ref|source)$/i;
const SEARCH_PATH = /^\/cars(?:\/[^/]+){0,3}\/?$/;

function isSearchKey(value: string): value is SearchKey {
  return value.startsWith('/cars');
}

export function classifyPage(location: URL): PageRoute {
  if (location.protocol !== 'https:' || location.hostname !== 'www.donedeal.ie') return { kind: 'unsupported' };
  if (location.pathname.startsWith('/cars-for-sale/')) {
    const listing = parseListingHref(location.pathname);
    return listing ? { kind: 'detail', listing } : { kind: 'unsupported' };
  }
  if (!SEARCH_PATH.test(location.pathname)) return { kind: 'unsupported' };
  const params = new URLSearchParams(
    [...location.searchParams].filter(([name]) => !TRACKING_PARAMS.test(name)).sort(([a], [b]) => a.localeCompare(b)),
  );
  const path = location.pathname.replace(/\/$/, '').toLowerCase();
  const key = params.size > 0 ? `${path}?${params}` : path;
  if (!isSearchKey(key)) return { kind: 'unsupported' };
  const pathSegments = decodeSegments(location.pathname);
  if (!pathSegments) return { kind: 'unsupported' };
  return { kind: 'search', searchKey: key, params, pathSegments };
}

function decodeSegments(pathname: string): string[] | null {
  try {
    return pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
}

function single(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 && values[0] ? values[0] : null;
}

/**
 * Filter facts from the URL. Make and model come only from confirmed page data,
 * because path segments alone do not distinguish a make from other routes.
 */
export function searchFilters(
  params: URLSearchParams,
  makeModel: { make: string; model: string | null } | null,
): SearchFilters {
  const transmission = single(params, 'transmission');
  const fuel = single(params, 'fuelType');
  const seller = single(params, 'sellerType');
  return {
    make: makeModel?.make ?? null,
    model: makeModel?.model ?? null,
    transmission: transmission ? parseTransmission(transmission) : null,
    fuel: fuel ? parseFuel(fuel) : null,
    sellerType: seller ? parseSellerTypeCode(seller) : null,
  };
}
