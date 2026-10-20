import type { ContentFp, ContextFp, TargetFp } from './ids';
import { isContentFp, isContextFp, isTargetFp } from './ids';
import type { Coverage, ListingFacts } from './listing';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Sorted-key JSON. Runs identically in the extension and the Worker. */
export function canonicalJson(value: Json): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number in fingerprint input');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`).join(',')}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function factsJson(facts: ListingFacts): Json {
  return {
    listingId: facts.listingId,
    price: facts.price,
    year: facts.year,
    mileage: facts.mileage,
    make: facts.make,
    model: facts.model,
    fuel: facts.fuel,
    transmission: facts.transmission,
    sellerType: facts.sellerType,
    engineLitres: facts.engineLitres,
    damageMentioned: facts.damageMentioned,
  };
}

export async function targetFingerprint(facts: ListingFacts): Promise<TargetFp> {
  const hex = await sha256Hex(`tyrekick.target.v1\n${canonicalJson(factsJson(facts))}`);
  if (!isTargetFp(hex)) throw new Error('digest is not hex');
  return hex;
}

export async function contextFingerprint(candidates: readonly ListingFacts[]): Promise<ContextFp> {
  const sorted = [...candidates].sort((a, b) => a.listingId.localeCompare(b.listingId));
  const hex = await sha256Hex(`tyrekick.context.v1\n${canonicalJson(sorted.map(factsJson))}`);
  if (!isContextFp(hex)) throw new Error('digest is not hex');
  return hex;
}

export async function contentFingerprint(input: {
  facts: ListingFacts;
  text: string;
  coverage: Coverage;
}): Promise<ContentFp> {
  const json = canonicalJson({ facts: factsJson(input.facts), text: input.text, coverage: input.coverage });
  const hex = await sha256Hex(`tyrekick.content.v1\n${json}`);
  if (!isContentFp(hex)) throw new Error('digest is not hex');
  return hex;
}
