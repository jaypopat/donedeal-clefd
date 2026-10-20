import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { contextFingerprint, targetFingerprint } from '../contracts/fingerprint';
import { LIMITS } from '../contracts/versions';
import { redact } from '../privacy/redact';
import type { BackgroundMessage, PriceDelivery, WarningDelivery } from '../messages';
import { facts } from '../../tests/support/listings';
import { NOW, cards, harness, newDocumentNonce, searchSync, until } from '../../tests/support/extension';
import { CacheSchema } from './cache';

const TAB = { tabId: 1, openerTabId: null };

let quiet: ReturnType<typeof spyOn> | null = null;
beforeAll(() => {
  quiet = spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => quiet?.mockRestore());

function priceDeliveries(messages: BackgroundMessage[]): PriceDelivery[] {
  return messages.flatMap((message) => (message.type === 'price' ? message.deliveries : []));
}

function warningDeliveries(messages: BackgroundMessage[]): WarningDelivery[] {
  return messages.flatMap((message) => (message.type === 'warning' ? message.deliveries : []));
}

async function enabled(options: { modelsFail?: boolean } = {}) {
  const h = harness(options);
  await h.background.onPopupMessage({ type: 'enable' });
  return h;
}

async function connect(h: ReturnType<typeof harness>, id: string, tab: { tabId: number; openerTabId: number | null } = TAB) {
  const documentNonce = newDocumentNonce();
  await h.background.connect({ id, ...tab, documentNonce: null });
  return documentNonce;
}

function storedEntries(h: ReturnType<typeof harness>) {
  return CacheSchema.parse(h.local.data.get('tyrekick.assessments') ?? { version: 1, generation: 0, entries: [] }).entries;
}

describe('consent', () => {
  test('sends nothing before consent', async () => {
    const h = harness();
    const nonce = await connect(h, 'doc');
    await h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
    expect(h.requests).toEqual([]);
    expect(h.messagesFor('doc').at(-1)).toEqual({ type: 'status', active: false, generation: 0 });
  });
});

describe('batching', () => {
  test('sends at most 20 targets per request and two requests at a time', async () => {
    const h = await enabled();
    h.hold(true);
    const nonce = await connect(h, 'doc');
    await h.background.onPageMessage('doc', searchSync(nonce, cards(45)));
    await until(() => h.gates.length === 2, 'two requests in flight');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.gates).toHaveLength(2);
    h.hold(false);
    for (const gate of h.gates.splice(0)) gate.release();
    await until(() => h.inFlight === 0 && h.gates.length === 0 && priceDeliveries(h.messagesFor('doc')).length === 45, 'all priced');
    expect(h.maxInFlight).toBe(2);
    for (const request of h.requests) {
      const ids = new Set([...(request.price?.targetIds ?? []), ...(request.warnings?.targets.map((target) => target.facts.listingId) ?? [])]);
      expect(ids.size).toBeLessThanOrEqual(LIMITS.maxTargetsPerRequest);
    }
    expect(h.requests.length).toBe(3);
  });
});

describe('caching', () => {
  test('serves repeat snapshots from cache and reprices a grown snapshot without repeating text checks', async () => {
    const h = await enabled();
    const nonce = await connect(h, 'doc');
    const first = cards(6);
    await h.background.onPageMessage('doc', searchSync(nonce, first));
    await until(() => priceDeliveries(h.messagesFor('doc')).length === 6 && warningDeliveries(h.messagesFor('doc')).length === 6);
    expect(h.requests).toHaveLength(1);

    await h.background.onPageMessage('doc', searchSync(nonce, first));
    await until(() => priceDeliveries(h.messagesFor('doc')).length === 12);
    expect(h.requests).toHaveLength(1);

    const grown = [...first, ...cards(1, 45000099)];
    await h.background.onPageMessage('doc', searchSync(nonce, grown));
    await until(() => h.requests.length === 2 && h.inFlight === 0);
    const repricing = h.requests[1];
    expect(repricing?.price?.targetIds).toHaveLength(7);
    expect(repricing?.warnings?.targets.map((target) => String(target.facts.listingId))).toEqual(['45000099']);
  });

  test('keeps price and warning entries under separate keys within one 200-entry bound', async () => {
    const h = await enabled();
    const nonce = await connect(h, 'doc');
    for (let page = 0; page < 3; page++) {
      await h.background.onPageMessage('doc', searchSync(nonce, cards(40, 46000000 + page * 100)));
      await until(() => h.inFlight === 0 && warningDeliveries(h.messagesFor('doc')).length === 40 * (page + 1), `page ${page}`);
    }
    await until(() => storedEntries(h).length === LIMITS.maxCachedAssessments, 'cache full');
    const entries = storedEntries(h);
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
    expect(entries.every((entry) => entry.key.startsWith(`${entry.branch}|`))).toBe(true);
  });

  test('does not cache service failures and retries them on the next sync', async () => {
    const h = await enabled();
    h.stopWorker();
    const nonce = await connect(h, 'doc');
    await h.background.onPageMessage('doc', searchSync(nonce, cards(2)));
    await until(() => priceDeliveries(h.messagesFor('doc')).length === 2 && warningDeliveries(h.messagesFor('doc')).length === 2);
    expect(priceDeliveries(h.messagesFor('doc')).map((delivery) => delivery.price)).toEqual([
      expect.objectContaining({ kind: 'assessed', assessment: expect.objectContaining({ result: { kind: 'unavailable', error: 'service_unavailable' } }) }),
      expect.objectContaining({ kind: 'assessed', assessment: expect.objectContaining({ result: { kind: 'unavailable', error: 'service_unavailable' } }) }),
    ]);
    expect(storedEntries(h)).toEqual([]);
    await h.background.onPageMessage('doc', searchSync(nonce, cards(2)));
    await until(() => h.requests.length === 2);
  });

  test('a failed warning branch leaves the price branch intact', async () => {
    const h = await enabled({ modelsFail: true });
    const nonce = await connect(h, 'doc');
    const withCue = cards(6).map((card) => ({ ...card, text: redact(`${card.text} only 40k miles`) }));
    await h.background.onPageMessage('doc', searchSync(nonce, withCue));
    await until(() => warningDeliveries(h.messagesFor('doc')).length === 6 && priceDeliveries(h.messagesFor('doc')).length === 6);
    expect(warningDeliveries(h.messagesFor('doc')).every((delivery) => delivery.assessment.result.kind === 'unavailable')).toBe(true);
    expect(priceDeliveries(h.messagesFor('doc')).every((delivery) => delivery.price.kind === 'assessed' && delivery.price.assessment.result.kind !== 'unavailable')).toBe(true);
    expect(storedEntries(h).every((entry) => entry.branch === 'price')).toBe(true);
  });

  test('expires entries after the TTL', async () => {
    const h = await enabled();
    const nonce = await connect(h, 'doc');
    await h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
    await until(() => h.inFlight === 0 && h.requests.length === 1 && storedEntries(h).length === 6);
    h.clock.now += LIMITS.assessmentTtlMs + 1;
    await h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
    await until(() => h.requests.length === 2);
  });
});

describe('pause and clear', () => {
  test('clear rejects late results and cache writes from before it', async () => {
    const h = await enabled();
    h.hold(true);
    const nonce = await connect(h, 'doc');
    await h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
    await until(() => h.gates.length === 1);
    const before = h.posted.length;
    await h.background.onPopupMessage({ type: 'clear-data' });
    h.gates.shift()?.release();
    await until(() => h.inFlight === 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const after = h.posted.slice(before).map((entry) => entry.message);
    expect(after).toEqual([{ type: 'status', active: true, generation: 1 }]);
    expect(storedEntries(h)).toEqual([]);
  });

  test('pause cancels queued work and stops new analysis', async () => {
    const h = await enabled();
    h.hold(true);
    const nonce = await connect(h, 'doc');
    await h.background.onPageMessage('doc', searchSync(nonce, cards(45)));
    await until(() => h.gates.length === 2);
    expect(await h.background.onPopupMessage({ type: 'pause' })).toEqual({ access: 'paused', cachedAssessments: 0 });
    h.hold(false);
    for (const gate of h.gates.splice(0)) gate.release();
    await until(() => h.inFlight === 0);
    await h.background.onPageMessage('doc', searchSync(nonce, cards(2, 47000000)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.requests).toHaveLength(2);
    expect(priceDeliveries(h.messagesFor('doc'))).toEqual([]);
    expect(storedEntries(h)).toEqual([]);
  });

  test('ignores page messages that fail validation', async () => {
    const h = await enabled();
    const nonce = await connect(h, 'doc');
    await h.background.onPageMessage('doc', { type: 'sync', documentNonce: nonce, page: { kind: 'search', cards: 'all of them' } });
    const unredacted = searchSync(nonce, cards(1)).page;
    const [card] = unredacted.cards;
    await h.background.onPageMessage('doc', {
      type: 'sync',
      documentNonce: nonce,
      page: { ...unredacted, cards: [{ facts: card?.facts, text: 'Call 087 123 4567' }] },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.requests).toEqual([]);
  });
});

describe('detail pages', () => {
  async function pricedSearch(h: ReturnType<typeof harness>) {
    const nonce = await connect(h, 'search', { tabId: 7, openerTabId: null });
    const cohort = cards(7);
    const sync = searchSync(nonce, cohort);
    await h.background.onPageMessage('search', sync);
    await until(() => priceDeliveries(h.messagesFor('search')).length === 7 && h.inFlight === 0);
    const target = cohort[0];
    if (!target) throw new Error('empty cohort');
    const opening = {
      listingId: target.facts.listingId,
      contextId: sync.page.contextId,
      contextFp: await contextFingerprint(cohort.map((card) => card.facts)),
      targetFp: await targetFingerprint(target.facts),
    };
    await h.background.onPageMessage('search', { type: 'opened', documentNonce: nonce, opening });
    return target;
  }

  function detailSync(nonce: ReturnType<typeof newDocumentNonce>, detailFacts: ReturnType<typeof facts>, text = 'Full service history.') {
    return { type: 'sync', documentNonce: nonce, page: { kind: 'detail', facts: detailFacts, text: redact(text), observedAt: NOW } };
  }

  test('reuses the originating search price for an ad opened from it, in the same or a new tab', async () => {
    const h = await enabled();
    const target = await pricedSearch(h);
    for (const [docId, tab] of [
      ['same-tab', { tabId: 7, openerTabId: null }],
      ['new-tab', { tabId: 8, openerTabId: 7 }],
    ] as const) {
      const nonce = await connect(h, docId, tab);
      await h.background.onPageMessage(docId, detailSync(nonce, target.facts));
      expect(priceDeliveries(h.messagesFor(docId))[0]?.price).toEqual({
        kind: 'assessed',
        assessment: expect.objectContaining({ scope: 'originating_search', observedAt: NOW }),
      });
    }
  });

  test('has no price context for a direct visit or a changed price, while warnings still run', async () => {
    const h = await enabled();
    const target = await pricedSearch(h);
    const direct = await connect(h, 'direct', { tabId: 9, openerTabId: null });
    await h.background.onPageMessage('direct', detailSync(direct, target.facts));
    expect(priceDeliveries(h.messagesFor('direct'))[0]?.price).toEqual({ kind: 'no_search_context' });
    await until(() => warningDeliveries(h.messagesFor('direct')).length === 1);
    expect(warningDeliveries(h.messagesFor('direct'))[0]?.assessment).toMatchObject({ coverage: 'detail', result: { kind: 'checked' } });

    const edited = await connect(h, 'edited', { tabId: 7, openerTabId: null });
    await h.background.onPageMessage('edited', detailSync(edited, { ...target.facts, price: { kind: 'cash', eur: 9999 } }));
    expect(priceDeliveries(h.messagesFor('edited'))[0]?.price).toEqual({ kind: 'no_search_context' });
  });

  test('a fresh full-listing check enriches the card only while overlapping facts agree', async () => {
    const h = await enabled();
    const [card] = cards(1, 48000001);
    if (!card) throw new Error('no card');
    const detailFacts = facts({ id: card.facts.listingId, eur: card.facts.price.kind === 'cash' ? card.facts.price.eur : 1, mileage: card.facts.mileage, engineLitres: 1.6 });
    const detail = await connect(h, 'detail', { tabId: 3, openerTabId: null });
    await h.background.onPageMessage('detail', detailSync(detail, detailFacts));
    await until(() => storedEntries(h).some((entry) => entry.branch === 'warning'));

    const cardFacts = { ...card.facts, transmission: null, make: null };
    const agreeing = await connect(h, 'agree', { tabId: 4, openerTabId: null });
    await h.background.onPageMessage('agree', searchSync(agreeing, [{ ...card, facts: cardFacts }]));
    expect(warningDeliveries(h.messagesFor('agree'))[0]?.assessment).toMatchObject({ coverage: 'detail', reusedFromDetail: true });

    const changed = await connect(h, 'changed', { tabId: 5, openerTabId: null });
    await h.background.onPageMessage('changed', searchSync(changed, [{ ...card, facts: { ...cardFacts, price: { kind: 'cash', eur: 1 } } }]));
    await until(() => warningDeliveries(h.messagesFor('changed')).length === 1);
    expect(warningDeliveries(h.messagesFor('changed'))[0]?.assessment).toMatchObject({ coverage: 'card', reusedFromDetail: false });

    h.clock.now += LIMITS.detailReuseMs + 1;
    const stale = await connect(h, 'stale', { tabId: 6, openerTabId: null });
    await h.background.onPageMessage('stale', searchSync(stale, [{ ...card, facts: cardFacts }]));
    await until(() => warningDeliveries(h.messagesFor('stale')).length === 1);
    expect(warningDeliveries(h.messagesFor('stale'))[0]?.assessment.reusedFromDetail).toBe(false);
  });
});
