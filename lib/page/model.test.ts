import { describe, expect, test } from 'bun:test';
import { newContextId } from '../contracts/ids';
import { contextFingerprint } from '../contracts/fingerprint';
import { LIMITS } from '../contracts/versions';
import { redact } from '../privacy/redact';
import type { PriceDelivery, WarningDelivery } from '../messages';
import { MAX_PAGE_CARDS, SearchSyncSchema } from '../messages';
import { classifyPage } from '../donedeal/page';
import { facts } from '../../tests/support/listings';
import type { Observed, PageModel, SearchModel } from './model';
import { acceptPrice, acceptWarning, newDetail, newSearch, openingFor, reconcileSearch, resetBranches, syncFor } from './model';

const NOW = 1_792_000_000_000;

function searchKey() {
  const route = classifyPage(new URL('https://www.donedeal.ie/cars/Volkswagen/Golf'));
  if (route.kind !== 'search') throw new Error('not a search');
  return route.searchKey;
}

function observed(count: number, start = 49000001): Observed[] {
  return Array.from({ length: count }, (_, index) => ({
    facts: facts({ id: String(start + index), eur: 15000 + index }),
    text: redact(`Golf ${index}`),
  }));
}

function idAt(model: SearchModel, index: number) {
  const id = model.order[index];
  if (!id) throw new Error(`no card at ${index}`);
  return id;
}

function priceFor(model: SearchModel, id: string, overrides: Partial<PriceDelivery> = {}): PriceDelivery {
  const binding = [...model.bindings.values()].find((entry) => entry.facts.listingId === id);
  if (!binding || !model.contextFp) throw new Error('no binding');
  return {
    listingId: binding.facts.listingId,
    targetFp: binding.targetFp,
    context: { contextId: model.contextId, contextFp: model.contextFp },
    price: {
      kind: 'assessed',
      assessment: {
        result: { kind: 'insufficient', reason: { code: 'no_close_matches' }, unknownFactCount: 0 },
        scope: 'this_search',
        observedAt: NOW,
        sampleSize: model.order.length,
        loadedCount: model.order.length,
      },
    },
    ...overrides,
  };
}

function warningFor(model: PageModel, id: string): WarningDelivery {
  const binding = model.kind === 'detail' ? model.binding : [...model.bindings.values()].find((entry) => entry.facts.listingId === id);
  if (!binding) throw new Error('no binding');
  return {
    listingId: binding.facts.listingId,
    contentFp: binding.contentFp,
    assessment: { result: { kind: 'checked', findings: [] }, coverage: binding.coverage, observedAt: NOW, reusedFromDetail: false },
  };
}

function priceKinds(model: SearchModel) {
  return [...model.bindings.values()].map((binding) => binding.price.kind);
}

describe('search snapshot', () => {
  test('starts every new card as checking and syncs cards in first-observed order', async () => {
    const { model, changed } = await reconcileSearch(newSearch(searchKey(), NOW), observed(3), NOW);
    expect(changed).toBe(true);
    expect(priceKinds(model)).toEqual(['checking', 'checking', 'checking']);
    expect(syncFor(model, new Set())?.kind).toBe('search');
    const again = await reconcileSearch(model, [...observed(3)].reverse(), NOW + 1);
    expect(again.changed).toBe(false);
    expect(again.model.order).toEqual(model.order);
  });

  test('accepts a price only for the current context, sample and target facts', async () => {
    const { model } = await reconcileSearch(newSearch(searchKey(), NOW), observed(3), NOW);
    const first = idAt(model, 0);
    const accepted = acceptPrice(model, priceFor(model, first));
    expect(accepted?.kind === 'search' && accepted.bindings.get(first)?.price.kind).toBe('assessed');
    const current = priceFor(model, first);
    const otherContext = current.context && { ...current.context, contextId: newContextId() };
    expect(acceptPrice(model, { ...current, context: otherContext })).toBeNull();
    const other = model.bindings.get(idAt(model, 1));
    expect(other && acceptPrice(model, { ...current, targetFp: other.targetFp })).toBeNull();
  });

  test('newly loaded cards replace old price labels but keep unchanged warning results', async () => {
    const first = await reconcileSearch(newSearch(searchKey(), NOW), observed(3), NOW);
    const [id] = first.model.order;
    if (!id) throw new Error('empty');
    const priced = acceptPrice(first.model, priceFor(first.model, id));
    const warned = priced && acceptWarning(priced, warningFor(priced, id));
    if (!warned || warned.kind !== 'search') throw new Error('not accepted');
    const stale = priceFor(warned, id);

    const grown = await reconcileSearch(warned, observed(4), NOW + 5000);
    expect(grown.changed).toBe(true);
    expect(priceKinds(grown.model)).toEqual(['checking', 'checking', 'checking', 'checking']);
    expect(grown.model.bindings.get(id)?.warning.kind).toBe('assessed');
    expect(grown.model.observedAt).toBe(NOW + 5000);
    expect(acceptPrice(grown.model, stale)).toBeNull();
  });

  test('an edited card loses both of its signals', async () => {
    const first = await reconcileSearch(newSearch(searchKey(), NOW), observed(2), NOW);
    const [id] = first.model.order;
    if (!id) throw new Error('empty');
    const warned = acceptWarning(first.model, warningFor(first.model, id));
    if (!warned || warned.kind !== 'search') throw new Error('not accepted');
    const edited = observed(2).map((card, index) => (index === 0 ? { ...card, facts: { ...card.facts, price: { kind: 'cash' as const, eur: 999 } } } : card));
    const next = await reconcileSearch(warned, edited, NOW);
    expect(next.model.bindings.get(id)?.warning.kind).toBe('checking');
    expect(acceptWarning(next.model, warningFor(warned, id))).toBeNull();
  });

  test('a new search starts a new context without old labels', async () => {
    const { model } = await reconcileSearch(newSearch(searchKey(), NOW), observed(2), NOW);
    const fresh = newSearch(searchKey(), NOW);
    expect(fresh.contextId).not.toBe(model.contextId);
    expect(fresh.bindings.size).toBe(0);
    expect(acceptPrice(fresh, priceFor(model, idAt(model, 0)))).toBeNull();
  });

  test('cards past the sample limit are shown as outside the comparison', async () => {
    const { model } = await reconcileSearch(newSearch(searchKey(), NOW), observed(LIMITS.maxCandidates + 2), NOW);
    expect(priceKinds(model).filter((kind) => kind === 'outside_sample')).toHaveLength(2);
    const outside = model.order.at(-1);
    expect(outside && openingFor(model, outside)).toBeNull();
    expect(openingFor(model, idAt(model, 0))).toMatchObject({ contextId: model.contextId, contextFp: model.contextFp });
  });

  test('clearing local data resets every shown signal', async () => {
    const { model } = await reconcileSearch(newSearch(searchKey(), NOW), observed(2), NOW);
    const warned = acceptWarning(model, warningFor(model, idAt(model, 0)));
    if (!warned || warned.kind !== 'search') throw new Error('not accepted');
    const reset = resetBranches(warned);
    expect(reset.kind === 'search' && [...reset.bindings.values()].every((binding) => binding.warning.kind === 'checking')).toBe(true);
  });

  test('bounds observations, order, and serialized visible IDs to MAX_PAGE_CARDS while keeping first 100 sample', async () => {
    const total = 350;
    const cards = observed(total);
    const { model } = await reconcileSearch(newSearch(searchKey(), NOW), cards, NOW);

    expect(model.order).toHaveLength(MAX_PAGE_CARDS);
    expect(model.bindings.size).toBe(MAX_PAGE_CARDS);
    expect(priceKinds(model).filter((kind) => kind === 'checking')).toHaveLength(LIMITS.maxCandidates);
    expect(priceKinds(model).filter((kind) => kind === 'outside_sample')).toHaveLength(MAX_PAGE_CARDS - LIMITS.maxCandidates);

    const visibleSet = new Set(cards.map((c) => c.facts.listingId));
    expect(visibleSet.size).toBe(total);

    const sync = syncFor(model, visibleSet);
    expect(sync).not.toBeNull();
    if (!sync || sync.kind !== 'search') throw new Error('expected search sync');

    expect(sync.cards).toHaveLength(MAX_PAGE_CARDS);
    expect(sync.visible).toHaveLength(MAX_PAGE_CARDS);

    const parsed = SearchSyncSchema.safeParse(sync);
    expect(parsed.success).toBe(true);
  });
});

describe('detail page', () => {
  test.each(['facts_changed', 'assessment_missing', 'damage_mentioned'] as const)('preserves the %s abstention for the current detail facts', async (reason) => {
    const [card] = observed(1);
    if (!card) throw new Error('empty');
    const model = await newDetail({ ...card, coverage: 'detail' }, NOW);
    const delivery: PriceDelivery = {
      listingId: card.facts.listingId, targetFp: model.binding.targetFp, context: null,
      price: { kind: 'comparison_unavailable', reason },
    };
    expect(acceptPrice(model, delivery)).toMatchObject({ binding: { price: delivery.price } });
    const changed = await newDetail({ ...card, facts: { ...card.facts, transmission: 'automatic' }, coverage: 'detail' }, NOW);
    expect(acceptPrice(changed, delivery)).toBeNull();
  });

  test('partial coverage survives sync and rejects a result for full coverage', async () => {
    const [card] = observed(1);
    if (!card) throw new Error('empty');
    const partial = await newDetail({ ...card, coverage: 'detail_partial' }, NOW);
    const full = await newDetail({ ...card, coverage: 'detail' }, NOW);
    expect(partial.binding.contentFp).not.toBe(full.binding.contentFp);
    expect(syncFor(partial, new Set())).toMatchObject({ kind: 'detail', coverage: 'detail_partial' });
    expect(acceptWarning(partial, {
      listingId: card.facts.listingId,
      contentFp: full.binding.contentFp,
      assessment: { coverage: 'detail', observedAt: NOW, reusedFromDetail: false, result: { kind: 'checked', findings: [] } },
    })).toBeNull();
  });

  test('accepts a no-search-context price only for its own listing', async () => {
    const [card] = observed(1);
    if (!card) throw new Error('empty');
    const model = await newDetail({ ...card, coverage: 'detail' }, NOW);
    const delivery: PriceDelivery = { listingId: card.facts.listingId, targetFp: model.binding.targetFp, context: null, price: { kind: 'no_search_context' } };
    expect(acceptPrice(model, delivery)).toMatchObject({ binding: { price: { kind: 'no_search_context' } } });
    const context = { contextId: newContextId(), contextFp: await contextFingerprint([card.facts]) };
    expect(acceptPrice(model, { ...delivery, context })).toBeNull();
  });
});
