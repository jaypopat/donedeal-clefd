import type { Comparable, EssentialField, FieldEvidenceName, InsufficientReason, MatchBounds, PriceLabel } from '../contracts/assess';
import { variantName } from '../contracts/variants';
import { MIN_PRICE_MATCHES } from '../contracts/versions';
import { warningLabel } from '../contracts/reasons';
import type { PriceAssessment, WarningAssessment } from '../messages';
import { REASON_TEMPLATES } from './templates';
import type { CardView, PriceView, WarningView } from './views';

export type Tone = 'good' | 'neutral' | 'caution' | 'danger' | 'muted';
export type Badge = { text: string; tone: Tone };

export type PriceSection = {
  heading: string;
  scope: string | null;
  summary: string;
  details: string[];
  comparables: Array<{ url: string; label: string }>;
};

export type FindingView = { title: string; quotes: string[]; fields: string[]; nextStep: string };

export type WarningSection = {
  heading: string;
  summary: string | null;
  findings: FindingView[];
  coverage: string | null;
};

export type Explanation = { price: PriceSection; warnings: WarningSection };

const LABELS: Record<PriceLabel, Badge> = {
  great: { text: 'Great price', tone: 'good' },
  typical: { text: 'Typical price', tone: 'neutral' },
  expensive: { text: 'Expensive', tone: 'caution' },
};

const CHECKING: Badge = { text: 'Checking', tone: 'muted' };
const UNAVAILABLE: Badge = { text: 'Temporarily unavailable', tone: 'muted' };
const NOT_ENOUGH: Badge = { text: 'Not enough data', tone: 'muted' };

const FIELD_NAMES: Record<EssentialField, string> = {
  make: 'make',
  model: 'model',
  year: 'year',
  mileage: 'mileage',
  fuel: 'fuel type',
  transmission: 'transmission',
  sellerType: 'seller type',
};

const FIELD_LABELS: Record<FieldEvidenceName, string> = {
  mileage: 'Listed mileage',
  year: 'Listed year',
  fuel: 'Listed fuel',
  transmission: 'Listed gearbox',
  sellerType: 'Listed as',
};

function thousands(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function euro(value: number): string {
  return `€${thousands(value)}`;
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function priceBadge(view: PriceView): Badge {
  switch (view.kind) {
    case 'checking':
      return CHECKING;
    case 'no_search_context':
    case 'comparison_unavailable':
    case 'outside_sample':
      return NOT_ENOUGH;
    case 'assessed': {
      const result = view.assessment.result;
      if (result.kind === 'ready') return LABELS[result.label];
      if (result.kind === 'reference') return { text: `${result.exactCount + result.partialCount} similar`, tone: 'muted' };
      return result.kind === 'insufficient' ? NOT_ENOUGH : UNAVAILABLE;
    }
    default: {
      const _exhaustive: never = view;
      return _exhaustive;
    }
  }
}

function warningBadge(view: WarningView): Badge | null {
  if (view.kind === 'checking') return CHECKING;
  const { result, coverage } = view.assessment;
  if (result.kind === 'unavailable') return UNAVAILABLE;
  const label = warningLabel(result.findings);
  if (label === 'suspicious') return { text: 'Suspicious', tone: 'danger' };
  if (label === 'check_details') return { text: 'Check details', tone: 'caution' };
  return coverage !== 'detail' ? { text: 'Limited info', tone: 'muted' } : null;
}

export function badgesFor(view: CardView): Badge[] {
  const price = priceBadge(view.price);
  const warning = warningBadge(view.warning);
  if (!warning) return [price];
  if (warning.text === price.text && (price === CHECKING || price === UNAVAILABLE)) return [price];
  return [price, warning];
}

export function accessibleSummary(view: CardView): string {
  const [price, warning] = [priceBadge(view.price), warningBadge(view.warning)];
  const parts = [`Price: ${price.text}`];
  if (view.price.kind === 'assessed' && view.price.assessment.result.kind === 'reference') {
    const result = view.price.assessment.result;
    parts[0] += result.exactCount + result.partialCount === 1 ? ' car, no price label' : ' cars, no price label';
  }
  parts.push(warning ? `Warnings: ${warning.text}` : 'No warning signs detected');
  return `Tyrekick. ${parts.join('. ')}. Show details.`;
}

function insufficientSummary(reason: InsufficientReason): { summary: string; details: string[] } {
  switch (reason.code) {
    case 'unknown_facts': {
      const names = reason.fields.map((field) => FIELD_NAMES[field]);
      const needsModel = reason.fields.includes('make') || reason.fields.includes('model');
      const filters = reason.fields.filter((field) => field === 'transmission' || field === 'fuel' || field === 'sellerType');
      const hint = needsModel
        ? 'Search for one make and model to compare prices.'
        : filters.length > 0
          ? `Filter the search by ${list(filters.map((field) => FIELD_NAMES[field]))} to compare prices.`
          : 'Close matches need these details.';
      return { summary: `This card doesn't show its ${list(names)}.`, details: [hint] };
    }
    case 'no_close_matches':
      return { summary: 'No close matches among the loaded cards.', details: [] };
    case 'variant_uncertain':
      return { summary: 'The title and trim do not establish one material variant.', details: ['Conflicting variant markers cannot support a price comparison.'] };
    case 'conflicting_facts':
      return { summary: `The title conflicts with the ${list(reason.fields.map((field) => FIELD_NAMES[field]))} information.`, details: ['Confirm these details before comparing prices.'] };
    case 'no_cash_price':
      return { summary: 'There is no cash asking price to compare.', details: [] };
    case 'damage_mentioned':
      return { summary: 'The listing mentions damage or parts, so it is not compared with other cars.', details: [] };
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

function scopeLine(assessment: PriceAssessment, matches: number | null, time: (ms: number) => string): string {
  const parts = [matches === null ? null : `${matches} close ${matches === 1 ? 'match' : 'matches'}`, `sampled ${time(assessment.observedAt)}`];
  if (assessment.scope === 'originating_search') parts.push('from the results you opened this ad from');
  return parts.filter(Boolean).join(' · ');
}

function sampleLimits(assessment: PriceAssessment, unknownFactCount: number): string[] {
  const lines: string[] = [];
  if (unknownFactCount > 0) {
    lines.push(`${unknownFactCount} loaded ${unknownFactCount === 1 ? 'car was' : 'cars were'} left out because key details aren't shown.`);
  }
  if (assessment.loadedCount > assessment.sampleSize) {
    lines.push(`Compared the first ${assessment.sampleSize} of ${assessment.loadedCount} loaded cards.`);
  }
  lines.push('Only cards loaded in this search count, not the wider market. Filters and promoted ads can skew them.');
  return lines;
}

function matchingLimits(bounds: MatchBounds): string[] {
  const lines: string[] = [];
  const variant = bounds.variant;
  if (variant.kind === 'not_separated') {
    lines.push("Trims and material variants aren't told apart for this model. The variant catalog does not cover it.");
  } else if (variant.target.kind === 'marked') {
    lines.push(`Compared only with listings explicitly marked ${variantName(variant.target.code)} in the title or trim.`);
  } else {
    lines.push(`Left out listings marked ${list(variant.codes.map(variantName))}. Unmarked does not confirm a base trim; an unmentioned variant may still be present.`);
  }
  if (bounds.targetFromTitle.length) lines.push(`This car's ${list(bounds.targetFromTitle.map((field) => FIELD_NAMES[field]))} information was read from its title.`);
  if (bounds.targetFromSearch.length) lines.push(`This car's ${list(bounds.targetFromSearch.map((field) => FIELD_NAMES[field]))} information comes from the verified search filters.`);
  if (bounds.targetConflicts.length) lines.push(`Conflicting ${list(bounds.targetConflicts.map((field) => FIELD_NAMES[field]))} evidence is unconfirmed and cannot count toward a price label.`);
  if (bounds.matchesFromTitle) lines.push(`${bounds.matchesFromTitle} similar listing${bounds.matchesFromTitle === 1 ? '' : 's'} had details read from ${bounds.matchesFromTitle === 1 ? 'its title' : 'their titles'}.`);
  if (bounds.matchesFromSearch) lines.push(`${bounds.matchesFromSearch} similar listing${bounds.matchesFromSearch === 1 ? ' uses' : 's use'} verified search filters for some details.`);
  return lines;
}

function comparableRows(comparables: readonly Comparable[]): PriceSection['comparables'] {
  return comparables.map((comparable) => ({
    url: comparable.url,
    label: [
      euro(comparable.priceEur), String(comparable.year), `${thousands(comparable.mileageKm)} km`,
      ...(comparable.variant ? [variantName(comparable.variant)] : []),
      ...comparable.unconfirmed.map((field) => `${FIELD_NAMES[field]} unconfirmed`),
    ].join(' · '),
  }));
}

function priceSection(view: PriceView, time: (ms: number) => string): PriceSection {
  const empty = { scope: null, details: [], comparables: [] };
  switch (view.kind) {
    case 'checking':
      return { ...empty, heading: 'Checking', summary: 'Comparing with this search…' };
    case 'no_search_context':
      return {
        ...empty,
        heading: 'Not enough data',
        summary: 'There is no saved search for this ad.',
        details: ['Open the ad from DoneDeal search results to compare it with that search.'],
      };
    case 'comparison_unavailable': {
      switch (view.reason) {
        case 'facts_changed':
          return { ...empty, heading: 'Not enough data', summary: 'The saved search comparison no longer applies to this ad.',
            details: ['The full listing has different or additional vehicle details. Open the ad from updated search results to compare it again.'] };
        case 'assessment_missing':
          return { ...empty, heading: 'Not enough data', summary: 'This ad was opened from search results, but its saved comparison is no longer available.',
            details: ['Open the ad from DoneDeal search results again to compare it with that search.'] };
        case 'damage_mentioned':
          return { ...empty, heading: 'Not enough data', ...insufficientSummary({ code: 'damage_mentioned' }) };
        default: {
          const _exhaustive: never = view.reason;
          return _exhaustive;
        }
      }
    }
    case 'outside_sample':
      return { ...empty, heading: 'Not enough data', summary: `Only the first ${view.sampleSize} loaded cards are compared.` };
    case 'assessed':
      break;
    default: {
      const _exhaustive: never = view;
      return _exhaustive;
    }
  }
  const { assessment } = view;
  const result = assessment.result;
  if (result.kind === 'unavailable') {
    return { ...empty, heading: 'Temporarily unavailable', summary: 'The price check did not run. Try again later.' };
  }
  if (result.kind === 'insufficient') {
    const { summary, details } = insufficientSummary(result.reason);
    return {
      heading: 'Not enough data',
      scope: `Compared with this search · ${scopeLine(assessment, null, time)}`,
      summary,
      details: [...details, ...sampleLimits(assessment, result.unknownFactCount)],
      comparables: [],
    };
  }
  if (result.kind === 'reference') {
    const summary = result.why === 'few_matches'
      ? result.exactCount === 0
        ? 'Similar listings were found, but key details are unconfirmed. No price label is given.'
        : `Only ${result.exactCount} close ${result.exactCount === 1 ? 'match' : 'matches'}. At least ${MIN_PRICE_MATCHES} are needed for a price label.`
      : result.why === 'dispersed'
        ? `Prices of the ${result.exactCount} close matches vary too widely for a label.`
        : 'A label changes when a match is left out or the matching window changes, so none is shown.';
    const prices = result.comparables.map((comparable) => comparable.priceEur);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const priceRange = low === high ? euro(low) : `${euro(low)}–${euro(high)}`;
    return {
      heading: `${result.exactCount + result.partialCount} similar`,
      scope: `Compared with this search · ${scopeLine(assessment, result.exactCount, time)}`,
      summary,
      details: [
        ...(result.partialCount ? [`${result.partialCount} more look similar but have unconfirmed fields. These do not count toward a price label; each linked partial names its unconfirmed fields.`] : []),
        `Linked asking ${low === high ? 'price' : 'prices'} ${priceRange}. This car ${euro(result.targetEur)}.`,
        ...matchingLimits(result.bounds), ...sampleLimits(assessment, result.unknownFactCount),
      ],
      comparables: comparableRows(result.comparables),
    };
  }
  const direction = result.deltaPercent < 0 ? 'below' : 'above';
  const details = [
    `Middle asking price ${euro(result.medianEur)}. Middle half ${euro(result.lowerQuartileEur)}–${euro(result.upperQuartileEur)}.`,
    `This car: ${euro(result.targetEur)}, ${Math.abs(result.deltaPercent)}% ${direction} the middle.`,
  ];
  if (result.label === 'great') details.push('A price observation, not a recommendation to buy.');
  return {
    heading: LABELS[result.label].text,
    scope: `Compared with this search · ${scopeLine(assessment, result.matchCount, time)}`,
    summary: details[0] ?? '',
    details: [...details.slice(1), ...matchingLimits(result.bounds), ...sampleLimits(assessment, result.unknownFactCount)],
    comparables: comparableRows(result.comparables),
  };
}

function coverageLine(assessment: WarningAssessment, time: (ms: number) => string): string {
  if (assessment.coverage === 'detail_partial') {
    return `Limited listing text · up to 4,000 characters checked · ${time(assessment.observedAt)}`;
  }
  if (assessment.reusedFromDetail) {
    return `Full listing checked when you opened the ad at ${time(assessment.observedAt)}. Later edits to the ad won't show here.`;
  }
  return assessment.coverage === 'card'
    ? `Card info only · checked ${time(assessment.observedAt)}`
    : `Full listing checked · ${time(assessment.observedAt)}`;
}

function warningSection(view: WarningView, time: (ms: number) => string): WarningSection {
  if (view.kind === 'checking') return { heading: 'Checking', summary: 'Checking the listing information…', findings: [], coverage: null };
  const { assessment } = view;
  const { result } = assessment;
  if (result.kind === 'unavailable') {
    return {
      heading: 'Temporarily unavailable',
      summary: "Warning checks didn't run. This doesn't mean the listing passed.",
      findings: [],
      coverage: null,
    };
  }
  const findings = result.findings.map((finding) => ({
    title: REASON_TEMPLATES[finding.reason].title,
    nextStep: REASON_TEMPLATES[finding.reason].nextStep,
    quotes: finding.evidence.flatMap((evidence) => (evidence.kind === 'text' ? [evidence.excerpt] : [])),
    fields: finding.evidence.flatMap((evidence) => (evidence.kind === 'field' ? [`${FIELD_LABELS[evidence.field]}: ${evidence.value}`] : [])),
  }));
  const label = warningLabel(result.findings);
  const heading = label === 'suspicious' ? 'Suspicious' : label === 'check_details' ? 'Check details' : assessment.coverage !== 'detail' ? 'Limited info' : 'Warnings';
  const summary =
    findings.length > 0
      ? 'Seller claims are unverified. These are questions to raise, not proof of a problem.'
      : assessment.coverage === 'detail_partial'
        ? 'This long listing received a limited text check. The full description may not have been checked.'
        : assessment.coverage === 'card'
        ? 'Only the card was checked. Open the ad for a fuller check.'
        : "No warning signs detected in the information checked. This doesn't verify the car or the seller.";
  return { heading, summary, findings, coverage: coverageLine(assessment, time) };
}

export function explain(view: CardView, time: (ms: number) => string): Explanation {
  return { price: priceSection(view.price, time), warnings: warningSection(view.warning, time) };
}
