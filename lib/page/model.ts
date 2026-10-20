import type { ContentFp, ContextFp, ContextId, ListingId, TargetFp } from '../contracts/ids';
import { newContextId } from '../contracts/ids';
import { contentFingerprint, contextFingerprint, targetFingerprint } from '../contracts/fingerprint';
import type { Coverage, ListingFacts } from '../contracts/listing';
import { LIMITS } from '../contracts/versions';
import type { RedactedText } from '../privacy/redact';
import type { CardView, PriceView, WarningView } from '../display/views';
import type { SearchKey } from '../donedeal/page';
import type { DetailSync, Opening, PriceDelivery, SearchSync, WarningDelivery } from '../messages';

export type Binding = {
  facts: ListingFacts;
  text: RedactedText;
  coverage: Coverage;
  targetFp: TargetFp;
  contentFp: ContentFp;
  price: PriceView;
  warning: WarningView;
};

/** One search snapshot. A new search key means a new context, never a merge. */
export type SearchModel = {
  kind: 'search';
  searchKey: SearchKey;
  contextId: ContextId;
  observedAt: number;
  contextFp: ContextFp | null;
  order: ListingId[];
  bindings: ReadonlyMap<ListingId, Binding>;
};

export type DetailModel = { kind: 'detail'; observedAt: number; binding: Binding };

export type PageModel = SearchModel | DetailModel;

export type Observed = { facts: ListingFacts; text: RedactedText };

const CHECKING = { kind: 'checking' } as const;

export function newSearch(searchKey: SearchKey, now: number): SearchModel {
  return { kind: 'search', searchKey, contextId: newContextId(), observedAt: now, contextFp: null, order: [], bindings: new Map() };
}

async function bindingFor(observed: Observed, coverage: Coverage, previous: Binding | undefined): Promise<Binding> {
  const targetFp = await targetFingerprint(observed.facts);
  const contentFp = await contentFingerprint({ facts: observed.facts, text: observed.text, coverage });
  return {
    ...observed,
    coverage,
    targetFp,
    contentFp,
    price: previous?.targetFp === targetFp ? previous.price : CHECKING,
    warning: previous?.contentFp === contentFp ? previous.warning : CHECKING,
  };
}

/**
 * Folds the cards currently in the DOM into the snapshot. Cards keep their
 * first-observed order, and the first LIMITS.maxCandidates form the sample.
 * A changed sample invalidates every price label at once.
 */
export async function reconcileSearch(
  model: SearchModel,
  observed: readonly Observed[],
  now: number,
): Promise<{ model: SearchModel; changed: boolean }> {
  const present = new Map(observed.map((card) => [card.facts.listingId, card]));
  const order = [
    ...model.order.filter((id) => present.has(id)),
    ...observed.map((card) => card.facts.listingId).filter((id) => !model.bindings.has(id)),
  ];
  const sample = new Set(order.slice(0, LIMITS.maxCandidates));
  const bindings = new Map<ListingId, Binding>();
  let changed = order.length !== model.order.length;
  for (const id of order) {
    const card = present.get(id);
    if (!card) continue;
    const previous = model.bindings.get(id);
    const binding = await bindingFor(card, 'card', previous);
    if (!previous || previous.targetFp !== binding.targetFp || previous.contentFp !== binding.contentFp) changed = true;
    bindings.set(id, binding);
  }
  const contextFp = order.length > 0 ? await contextFingerprint(order.slice(0, LIMITS.maxCandidates).flatMap((id) => bindings.get(id)?.facts ?? [])) : null;
  const sampleChanged = contextFp !== model.contextFp;
  for (const [id, binding] of bindings) {
    if (!sample.has(id)) bindings.set(id, { ...binding, price: { kind: 'outside_sample', sampleSize: LIMITS.maxCandidates } });
    else if (sampleChanged) bindings.set(id, { ...binding, price: CHECKING });
  }
  return {
    model: { ...model, order, bindings, contextFp, observedAt: sampleChanged ? now : model.observedAt },
    changed: changed || sampleChanged,
  };
}

export async function newDetail(observed: Observed, now: number): Promise<DetailModel> {
  return { kind: 'detail', observedAt: now, binding: await bindingFor(observed, 'detail', undefined) };
}

/** Accepts a price only for the exact context, sample and target facts that were submitted. */
export function acceptPrice(model: PageModel, delivery: PriceDelivery): PageModel | null {
  if (model.kind === 'detail') {
    const { binding } = model;
    if (delivery.context !== null || delivery.listingId !== binding.facts.listingId || delivery.targetFp !== binding.targetFp) return null;
    const price: PriceView = delivery.price.kind === 'assessed' ? delivery.price : { kind: 'no_search_context' };
    return { ...model, binding: { ...binding, price } };
  }
  const binding = model.bindings.get(delivery.listingId);
  if (!binding || binding.price.kind === 'outside_sample' || delivery.price.kind !== 'assessed') return null;
  if (delivery.context?.contextId !== model.contextId || delivery.context.contextFp !== model.contextFp) return null;
  if (delivery.targetFp !== binding.targetFp) return null;
  const bindings = new Map(model.bindings);
  bindings.set(delivery.listingId, { ...binding, price: delivery.price });
  return { ...model, bindings };
}

/** Accepts a warning only for the exact content fingerprint that was submitted. */
export function acceptWarning(model: PageModel, delivery: WarningDelivery): PageModel | null {
  const binding = model.kind === 'detail' ? model.binding : model.bindings.get(delivery.listingId);
  if (!binding || binding.facts.listingId !== delivery.listingId || binding.contentFp !== delivery.contentFp) return null;
  const updated: Binding = { ...binding, warning: { kind: 'assessed', assessment: delivery.assessment } };
  if (model.kind === 'detail') return { ...model, binding: updated };
  const bindings = new Map(model.bindings);
  bindings.set(delivery.listingId, updated);
  return { ...model, bindings };
}

/** After local data is cleared, nothing shown so far may survive. */
export function resetBranches(model: PageModel): PageModel {
  const reset = (binding: Binding): Binding => ({
    ...binding,
    price: binding.price.kind === 'outside_sample' ? binding.price : CHECKING,
    warning: CHECKING,
  });
  if (model.kind === 'detail') return { ...model, binding: reset(model.binding) };
  return { ...model, bindings: new Map([...model.bindings].map(([id, binding]) => [id, reset(binding)])) };
}

export function syncFor(model: PageModel, visible: ReadonlySet<ListingId>): SearchSync | DetailSync | null {
  if (model.kind === 'detail') {
    return { kind: 'detail', facts: model.binding.facts, text: model.binding.text, observedAt: model.observedAt };
  }
  const cards = model.order.flatMap((id) => {
    const binding = model.bindings.get(id);
    return binding ? [{ facts: binding.facts, text: binding.text }] : [];
  });
  if (cards.length === 0) return null;
  return { kind: 'search', contextId: model.contextId, observedAt: model.observedAt, cards, visible: [...visible] };
}

export function openingFor(model: PageModel, listingId: ListingId): Opening | null {
  if (model.kind !== 'search' || !model.contextFp) return null;
  const binding = model.bindings.get(listingId);
  if (!binding || binding.price.kind === 'outside_sample') return null;
  return { listingId, contextId: model.contextId, contextFp: model.contextFp, targetFp: binding.targetFp };
}

export function viewOf(binding: Binding): CardView {
  return { listingId: binding.facts.listingId, url: binding.facts.url, coverage: binding.coverage, price: binding.price, warning: binding.warning };
}
