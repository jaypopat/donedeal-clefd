import { z } from 'zod';

export function canonicalMake(make: string): string {
  const name = make.normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (name === 'vw') return 'volkswagen';
  if (name === 'mercedes' || name === 'merc') return 'mercedes-benz';
  return name;
}

export function catalogKey(make: string, model: string): string {
  return `${canonicalMake(make)} ${model.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

export const CATALOG_MODELS = {
  golf: { make: 'Volkswagen', model: 'Golf' },
  polo: { make: 'Volkswagen', model: 'Polo' },
  aqua: { make: 'Toyota', model: 'Aqua' },
} as const;

export const VARIANTS = [
  { code: 'gti', name: 'GTI', models: ['golf', 'polo'], markers: [/\bgti\b/i, /\bclubsport\b/i] },
  { code: 'gtd', name: 'GTD', models: ['golf'], markers: [/\bgtd\b/i] },
  { code: 'gte', name: 'GTE', models: ['golf'], markers: [/\bgte\b/i] },
  { code: 'r', name: 'R', models: ['golf'], markers: [/\br\b(?![\s'’"/-]*line\b)/i, /\br32\b/i] },
  { code: 'r_line', name: 'R-Line', models: ['golf'], markers: [/\br[\s'’"/-]*line\b/i] },
  { code: 'gs', name: "G's / Gsports", models: ['aqua'], markers: [/\bg['’]?s\b/i, /\bg[\s-]?sports?\b/i, /\bgsports?\b/i] },
  { code: 'gr_sport', name: 'GR Sport', models: ['aqua'], markers: [/\bgr[\s-]*sport\b/i] },
] as const satisfies readonly { code: string; name: string; models: readonly (keyof typeof CATALOG_MODELS)[]; markers: readonly RegExp[] }[];

export const VariantCodeSchema = z.enum(VARIANTS.map((variant) => variant.code));
export type VariantCode = z.infer<typeof VariantCodeSchema>;

export function variantsFor(make: string | null, model: string | null): VariantCode[] {
  if (!make || !model) return [];
  const key = catalogKey(make, model);
  return VARIANTS.filter((variant) => variant.models.some((modelId) => {
    const identity = CATALOG_MODELS[modelId];
    return catalogKey(identity.make, identity.model) === key;
  })).map((variant) => variant.code);
}

export function markedVariants(make: string | null, model: string | null, text: string): VariantCode[] {
  const codes = variantsFor(make, model);
  return VARIANTS.filter((variant) => codes.includes(variant.code) && variant.markers.some((marker) => marker.test(text))).map((variant) => variant.code);
}

export function variantName(code: VariantCode): string {
  return VARIANTS.find((variant) => variant.code === code)?.name ?? code;
}
