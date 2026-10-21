import type { ListingFacts, TitleField, Transmission, Variant } from '../contracts/listing';
import { CATALOG_MODELS, canonicalMake, markedVariants, variantsFor } from '../contracts/variants';

type Identity = Pick<ListingFacts, 'make' | 'model' | 'transmission' | 'variant' | 'titleEvidence'>;

const MAKE_ALIASES: Record<string, readonly string[]> = {
  audi: ['audi'],
  bmw: ['bmw'],
  citroen: ['citroen', 'citroën'],
  cupra: ['cupra'],
  dacia: ['dacia'],
  fiat: ['fiat'],
  ford: ['ford'],
  honda: ['honda'],
  hyundai: ['hyundai'],
  jaguar: ['jaguar'],
  jeep: ['jeep'],
  kia: ['kia'],
  'land rover': ['land rover', 'range rover'],
  lexus: ['lexus'],
  mazda: ['mazda'],
  mg: ['mg'],
  mini: ['mini'],
  mitsubishi: ['mitsubishi'],
  nissan: ['nissan'],
  opel: ['opel'],
  peugeot: ['peugeot'],
  porsche: ['porsche'],
  renault: ['renault'],
  seat: ['seat'],
  skoda: ['skoda', 'škoda'],
  subaru: ['subaru'],
  suzuki: ['suzuki'],
  tesla: ['tesla'],
  toyota: ['toyota'],
  vauxhall: ['vauxhall'],
  volvo: ['volvo'],
  volkswagen: ['volkswagen', 'vw'],
  'mercedes-benz': ['mercedes benz', 'mercedes', 'merc'],
};

function words(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
}

function namesContraryMake(title: string, alias: string): boolean {
  if (['seat', 'mini', 'mg'].includes(alias)) {
    const beginning = words(title).trim().replace(/^(?:19|20)\d{2}\s+/, '');
    return beginning === alias || beginning.startsWith(`${alias} `);
  }
  return words(title).includes(words(alias));
}

function namesModel(title: string, identity: { make: string; model: string }): boolean {
  const make = canonicalMake(identity.make);
  return (MAKE_ALIASES[make] ?? [make]).some((alias) => words(title).includes(words(alias))) &&
    words(title).includes(words(identity.model));
}

function gearbox(title: string): { value: Transmission | null; ambiguous: boolean } {
  if (/\bsemi[\s-]*(?:auto|automatic)\b/i.test(title)) return { value: null, ambiguous: true };
  const automatic = /\b(auto(?:matic)?(?![\s-]*(?:lights?|wipers?|hold|park|sales)\b)|dsg|cvt)\b/i.test(title);
  const manual = /\bmanual\b/i.test(title);
  return { value: automatic === manual ? null : automatic ? 'automatic' : 'manual', ambiguous: automatic && manual };
}

function readVariant(make: string | null, model: string | null, title: string, trim: string | null): Variant {
  if (variantsFor(make, model).length === 0) return { kind: 'not_catalogued' };
  const titleCodes = markedVariants(make, model, title);
  const trimCodes = markedVariants(make, model, trim ?? '');
  const all = new Set([...titleCodes, ...trimCodes]);
  if (all.size > 1) return { kind: 'ambiguous' };
  const code = trimCodes[0] ?? titleCodes[0];
  return code ? { kind: 'marked', code, source: trimCodes.length ? 'trim' : 'title' }
    : { kind: 'unmarked', source: trim ? 'trim' : 'title' };
}

export function readIdentity(input: {
  title: string;
  listed: { make: string | null; model: string | null; transmission: Transmission | null };
  corroborate: { make: string | null; model: string | null } | null;
  trim: string | null;
}): Identity {
  let { make, model, transmission } = input.listed;
  const recovered: TitleField[] = [];
  const conflicts: TitleField[] = [];
  const listedMake = make ? canonicalMake(make) : null;
  if (listedMake && Object.entries(MAKE_ALIASES).some(([name, aliases]) =>
    name !== listedMake && aliases.some((alias) => namesContraryMake(input.title, alias)))) conflicts.push('make');
  const corroborate = input.corroborate;
  const namedModels = Object.values(CATALOG_MODELS).filter((identity) => namesModel(input.title, identity) ||
    make && canonicalMake(make) === canonicalMake(identity.make) && words(input.title).includes(words(identity.model)));
  if (namedModels.length <= 1 && corroborate?.make && corroborate.model && namesModel(input.title, { make: corroborate.make, model: corroborate.model })) {
    if (!make) { make = corroborate.make; recovered.push('make'); }
    if (!model) { model = corroborate.model; recovered.push('model'); }
  }
  for (const known of namedModels) {
    if (make && canonicalMake(make) !== canonicalMake(known.make)) conflicts.push('make');
    if (model && words(model) !== words(known.model)) conflicts.push('model');
  }
  const titleGearbox = gearbox(input.title);
  if (transmission && (titleGearbox.ambiguous || titleGearbox.value && titleGearbox.value !== transmission)) {
    conflicts.push('transmission');
  } else if (!transmission && titleGearbox.value) {
    transmission = titleGearbox.value;
    recovered.push('transmission');
  }
  const distinctConflicts = [...new Set(conflicts)].sort();
  return {
    make, model, transmission,
    variant: readVariant(make, model, input.title, input.trim),
    titleEvidence: { recovered: recovered.filter((field) => !distinctConflicts.includes(field)).sort(), conflicts: distinctConflicts },
  };
}
