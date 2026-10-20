import { z } from 'zod';

export type ListingId = string & { readonly __brand: 'ListingId' };
export type ListingUrl = string & { readonly __brand: 'ListingUrl' };
export type ContextId = string & { readonly __brand: 'ContextId' };
export type DocumentNonce = string & { readonly __brand: 'DocumentNonce' };
export type TargetFp = string & { readonly __brand: 'TargetFp' };
export type ContextFp = string & { readonly __brand: 'ContextFp' };
export type ContentFp = string & { readonly __brand: 'ContentFp' };

const LISTING_ID = /^[1-9]\d{4,11}$/;
const LISTING_URL = /^https:\/\/www\.donedeal\.ie\/cars-for-sale\/[a-z0-9-]{1,200}\/([1-9]\d{4,11})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isListingId(value: unknown): value is ListingId {
  return typeof value === 'string' && LISTING_ID.test(value);
}

export function isListingUrl(value: unknown): value is ListingUrl {
  return typeof value === 'string' && LISTING_URL.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function isContextId(value: unknown): value is ContextId {
  return isUuid(value);
}

export function isDocumentNonce(value: unknown): value is DocumentNonce {
  return isUuid(value);
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value);
}

export function isTargetFp(value: unknown): value is TargetFp {
  return isSha256Hex(value);
}

export function isContextFp(value: unknown): value is ContextFp {
  return isSha256Hex(value);
}

export function isContentFp(value: unknown): value is ContentFp {
  return isSha256Hex(value);
}

export function newContextId(): ContextId {
  const id = crypto.randomUUID();
  if (!isContextId(id)) throw new Error('crypto.randomUUID returned a non-UUID');
  return id;
}

export function newDocumentNonce(): DocumentNonce {
  const nonce = crypto.randomUUID();
  if (!isDocumentNonce(nonce)) throw new Error('crypto.randomUUID returned a non-UUID');
  return nonce;
}

export function listingIdOfUrl(url: ListingUrl): ListingId {
  const id = LISTING_URL.exec(url)?.[1];
  if (!isListingId(id)) throw new Error('ListingUrl without a listing id');
  return id;
}

export type ListingRef = { id: ListingId; url: ListingUrl };

/** Canonicalises a DoneDeal car ad href: HTTPS www host, no query or fragment. */
export function parseListingHref(href: string, base = 'https://www.donedeal.ie'): ListingRef | null {
  let parsed: URL;
  try {
    parsed = new URL(href, base);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.donedeal.ie') return null;
  const url = `https://www.donedeal.ie${parsed.pathname}`;
  if (!isListingUrl(url)) return null;
  return { id: listingIdOfUrl(url), url };
}

export const ListingIdSchema = z.custom<ListingId>(isListingId, { message: 'invalid listing id' });
export const ListingUrlSchema = z.custom<ListingUrl>(isListingUrl, { message: 'invalid listing url' });
export const ContextIdSchema = z.custom<ContextId>(isContextId, { message: 'invalid context id' });
export const DocumentNonceSchema = z.custom<DocumentNonce>(isDocumentNonce, { message: 'invalid document nonce' });
export const TargetFpSchema = z.custom<TargetFp>(isTargetFp, { message: 'invalid fingerprint' });
export const ContextFpSchema = z.custom<ContextFp>(isContextFp, { message: 'invalid fingerprint' });
export const ContentFpSchema = z.custom<ContentFp>(isContentFp, { message: 'invalid fingerprint' });

/** Milliseconds since the Unix epoch. Client clocks are untrusted and only scope a private comparison. */
export const EpochMsSchema = z.int().min(1_600_000_000_000).max(4_102_444_800_000);
