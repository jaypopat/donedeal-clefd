import type { EssentialField, FieldEvidenceName, InsufficientReason, PriceLabel } from '../contracts/assess';
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
    case 'outside_sample':
      return NOT_ENOUGH;
    case 'assessed': {
      const result = view.assessment.result;
      if (result.kind === 'ready') return LABELS[result.label];
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
  parts.push(warning ? `Warnings: ${warning.text}` : 'No warning signs detected');
  return `Tyrekick. ${parts.join('. ')}. Show details.`;
}

function insufficientSummary(reason: InsufficientReason, matchCount: number): { summary: string; details: string[] } {
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
    case 'too_few_matches':
      return {
        summary: `Only ${matchCount} close ${matchCount === 1 ? 'match' : 'matches'} among the loaded cards. At least 5 are needed.`,
        details: [],
      };
    case 'dispersed':
      return { summary: `Asking prices of the ${matchCount} close matches vary too widely to compare.`, details: [] };
    case 'unstable':
      return { summary: `The label would change if one of the ${matchCount} close matches were left out, so none is shown.`, details: [] };
    case 'no_cash_price':
      return { summary: 'There is no cash asking price to compare.', details: [] };
    case 'damage_mentioned':
      return { summary: 'The title mentions damage or parts, so it is not compared with other cars.', details: [] };
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
    const { summary, details } = insufficientSummary(result.reason, result.matchCount);
    return {
      heading: 'Not enough data',
      scope: `Compared with this search · ${scopeLine(assessment, null, time)}`,
      summary,
      details: [...details, ...sampleLimits(assessment, result.unknownFactCount)],
      comparables: [],
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
    details: [...details.slice(1), ...sampleLimits(assessment, result.unknownFactCount)],
    comparables: result.comparables.map((comparable) => ({
      url: comparable.url,
      label: `${euro(comparable.priceEur)} · ${comparable.year} · ${thousands(comparable.mileageKm)} km`,
    })),
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
