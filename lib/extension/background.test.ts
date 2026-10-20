import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { contextFingerprint, targetFingerprint } from '../contracts/fingerprint';
import { LIMITS } from '../contracts/versions';
import { redact } from '../privacy/redact';
import type { BackgroundMessage, PriceDelivery, WarningDelivery } from '../messages';
import { facts } from '../../tests/support/listings';
import { NOW, cards, harness, memoryArea, newDocumentNonce, searchSync, until } from '../../tests/support/extension';
import { CacheSchema } from './cache';
import { startCacheCleanup } from './background';
import { createStore } from './store';
import { classifyPage } from '../donedeal/page';
import { acceptPrice, newSearch, reconcileSearch, type PageModel } from '../page/model';

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

function delayNext<Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) {
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let held = false;
  return {
    started,
    release: () => release(),
    async run(...args: Args): Promise<Result> {
      const shouldHold = !held;
      held = true;
      const result = await operation(...args);
      if (shouldHold) {
        entered();
        await gate;
      }
      return result;
    },
  };
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
  test('identical searches share one delayed request and both accept their own context', async () => {
    const h = await enabled();
    h.hold(true);
    const route = classifyPage(new URL('https://www.donedeal.ie/cars/Volkswagen/Golf'));
    if (route.kind !== 'search') throw new Error('expected search route');
    const cohort = cards(7);
    const first = (await reconcileSearch(newSearch(route.searchKey, NOW), cohort, NOW)).model;
    const second = (await reconcileSearch(newSearch(route.searchKey, NOW + 1), cohort, NOW + 1)).model;
    expect(first.contextId).not.toBe(second.contextId);
    const nonce1 = await connect(h, 'first');
    const nonce2 = await connect(h, 'second', { tabId: 2, openerTabId: null });
    await h.background.onPageMessage('first', searchSync(nonce1, cohort, first.contextId));
    await until(() => h.gates.length === 1);
    const sync2 = searchSync(nonce2, cohort, second.contextId);
    sync2.page.observedAt = NOW + 1;
    await h.background.onPageMessage('second', sync2);
    expect(h.requests).toHaveLength(1);
    h.hold(false);
    h.gates.shift()?.release();
    await until(() => priceDeliveries(h.messagesFor('first')).length === 7 && priceDeliveries(h.messagesFor('second')).length === 7);
    for (const [docId, model] of [['first', first], ['second', second]] as const) {
      let accepted: PageModel = model;
      for (const delivery of priceDeliveries(h.messagesFor(docId))) {
        expect(delivery.context?.contextId).toBe(model.contextId);
        expect(delivery.price).toMatchObject({ kind: 'assessed', assessment: { observedAt: model.observedAt, result: { kind: 'ready' } } });
        const next = acceptPrice(accepted, delivery);
        expect(next).not.toBeNull();
        if (next) accepted = next;
      }
      expect(accepted.kind === 'search' && [...accepted.bindings.values()].every((binding) => binding.price.kind === 'assessed')).toBe(true);
    }
    expect(h.requests).toHaveLength(1);
  });

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
  test('startup and scheduled cleanup remove expired storage while paused without requests', async () => {
    const h = await enabled();
    const nonce = await connect(h, 'doc');
    await h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
    await until(() => storedEntries(h).length === 6);
    await h.background.onPopupMessage({ type: 'pause' });
    const expired = structuredClone(h.local.data.get('tyrekick.assessments'));
    let listener = (_alarm: { name: string }) => {};
    const scheduled: { name: string; periodInMinutes: number }[] = [];
    const alarms = {
      async get(name: string) { return scheduled.find((alarm) => alarm.name === name); },
      async create(name: string, info: { periodInMinutes: number }) { scheduled.push({ name, ...info }); },
      onAlarm: { addListener(callback: typeof listener) { listener = callback; } },
    };
    await startCacheCleanup(h.store, alarms);
    expect(scheduled).toEqual([{ name: 'tyrekick-cache-expiry', periodInMinutes: 1 }]);
    expect(storedEntries(h)).toHaveLength(6);
    h.clock.now += LIMITS.assessmentTtlMs;
    listener({ name: 'unrelated-alarm' });
    expect(storedEntries(h)).toHaveLength(6);
    listener({ name: 'tyrekick-cache-expiry' });
    await until(() => storedEntries(h).length === 0);
    h.local.data.set('tyrekick.assessments', expired);
    const restarted = createStore({ local: h.local, session: memoryArea(), now: () => h.clock.now });
    await startCacheCleanup(restarted, alarms);
    expect(storedEntries(h)).toEqual([]);
    expect(scheduled).toHaveLength(1);
    expect(h.requests).toHaveLength(1);
  });

  for (const action of ['clear', 'put'] as const) {
    test(`expiry cleanup preserves a concurrent ${action}`, async () => {
      const h = await enabled();
      const nonce = await connect(h, 'doc');
      await h.background.onPageMessage('doc', searchSync(nonce, cards(1)));
      await until(() => storedEntries(h).length === 2);
      const entry = storedEntries(h)[0];
      if (!entry) throw new Error('expected cached entry');
      h.clock.now += LIMITS.assessmentTtlMs;
      const held = delayNext(h.local.get);
      const get = h.local.get;
      h.local.get = (key) => key === 'tyrekick.assessments' ? held.run(key) : get(key);
      const pruning = h.store.snapshot();
      await held.started;
      if (action === 'clear') await h.store.clear();
      else expect(await h.store.put({ ...entry, storedAt: h.clock.now }, 0)).toBe(true);
      held.release();
      const snapshot = await pruning;
      expect(snapshot.settings.generation).toBe(action === 'clear' ? 1 : 0);
      expect(snapshot.cache.entries).toEqual(action === 'clear' ? [] : [{ ...entry, storedAt: h.clock.now }]);
      expect(storedEntries(h)).toEqual(snapshot.cache.entries);
    });
  }

  test('status reads persist expiry while paused at the TTL boundary', async () => {
    const h = await enabled();
    const nonce = await connect(h, 'doc');
    await h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
    await until(() => storedEntries(h).length === 6);
    await h.background.onPopupMessage({ type: 'pause' });
    h.clock.now += LIMITS.assessmentTtlMs - 1;
    expect(await h.background.onPopupMessage({ type: 'get-state' })).toEqual({ access: 'paused', cachedAssessments: 6 });
    h.clock.now += 1;
    expect(await h.background.onPopupMessage({ type: 'get-state' })).toEqual({ access: 'paused', cachedAssessments: 0 });
    expect(storedEntries(h)).toEqual([]);
    expect(h.requests).toHaveLength(1);
  });

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
  for (const control of ['pause', 'clear-data'] as const) {
    for (const cached of [false, true]) {
      test(`${control} rejects ${cached ? 'cached delivery' : 'requests'} from a preparing snapshot`, async () => {
        const h = await enabled();
        const nonce = await connect(h, 'doc');
        const sync = searchSync(nonce, cards(3));
        if (cached) {
          await h.background.onPageMessage('doc', sync);
          await until(() => h.inFlight === 0 && storedEntries(h).length === 6);
        }
        const held = delayNext(h.store.snapshot);
        h.store.snapshot = held.run;
        const preparing = h.background.onPageMessage('doc', sync);
        await held.started;
        await h.background.onPopupMessage({ type: control });
        const requestCount = h.requests.length;
        const messageCount = h.posted.length;
        held.release();
        await preparing;
        expect(h.requests).toHaveLength(requestCount);
        expect(h.posted).toHaveLength(messageCount);
      });
    }

    test(`${control} rejects search work already fingerprinting`, async () => {
      const h = await enabled();
      const nonce = await connect(h, 'doc');
      const held = delayNext(crypto.subtle.digest.bind(crypto.subtle));
      const digest = spyOn(crypto.subtle, 'digest').mockImplementation(held.run);
      try {
        const preparing = h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
        await held.started;
        await h.background.onPopupMessage({ type: control });
        const before = h.posted.length;
        held.release();
        await preparing;
        expect(h.requests).toEqual([]);
        expect(h.posted).toHaveLength(before);
      } finally {
        held.release();
        digest.mockRestore();
      }
    });

    test(`${control} rejects detail work looking up its originating price`, async () => {
      const h = await enabled();
      const nonce = await connect(h, 'doc');
      const held = delayNext(h.store.findOpening);
      h.store.findOpening = held.run;
      const preparing = h.background.onPageMessage('doc', {
        type: 'sync', documentNonce: nonce,
        page: { kind: 'detail', facts: facts({ id: '45000001' }), text: redact('Full service history.'), observedAt: NOW },
      });
      await held.started;
      await h.background.onPopupMessage({ type: control });
      const before = h.posted.length;
      held.release();
      await preparing;
      expect(h.requests).toEqual([]);
      expect(h.posted).toHaveLength(before);
    });

    test(`${control} rejects cached detail results while warning preparation finishes`, async () => {
      const h = await enabled();
      const nonce = await connect(h, 'doc');
      const sync = {
        type: 'sync', documentNonce: nonce,
        page: { kind: 'detail', facts: facts({ id: '45000001' }), text: redact('Full service history.'), observedAt: NOW },
      };
      await h.background.onPageMessage('doc', sync);
      await until(() => h.inFlight === 0 && storedEntries(h).length === 1);
      const original = crypto.subtle.digest.bind(crypto.subtle);
      const held = delayNext(original);
      let calls = 0;
      const digest = spyOn(crypto.subtle, 'digest').mockImplementation((...args) => ++calls === 2 ? held.run(...args) : original(...args));
      try {
        const before = h.posted.length;
        const preparing = h.background.onPageMessage('doc', sync);
        await held.started;
        await h.background.onPopupMessage({ type: control });
        held.release();
        await preparing;
        expect(h.posted.slice(before).map((entry) => entry.message)).toEqual([
          { type: 'status', active: control !== 'pause', generation: control === 'clear-data' ? 1 : 0 },
        ]);
        expect(h.requests).toHaveLength(1);
      } finally {
        held.release();
        digest.mockRestore();
      }
    });
  }

  test('pause blocks admission before its settings write commits', async () => {
    const h = await enabled();
    const nonce = await connect(h, 'doc');
    const preparation = delayNext(h.store.snapshot);
    h.store.snapshot = preparation.run;
    const preparing = h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
    await preparation.started;
    const write = delayNext(async () => {});
    const set = h.local.set;
    h.local.set = async (key, value) => {
      if (key === 'tyrekick.settings') await write.run();
      await set(key, value);
    };
    const pausing = h.background.onPopupMessage({ type: 'pause' });
    await write.started;
    preparation.release();
    await preparing;
    await h.background.onPageMessage('doc', searchSync(nonce, cards(2, 47000000)));
    const requests = [...h.requests];
    write.release();
    await pausing;
    expect(requests).toEqual([]);
    expect(priceDeliveries(h.messagesFor('doc'))).toEqual([]);
  });

  test('clear blocks admission until the generation commits and requests a fresh sync', async () => {
    const h = await enabled();
    const nonce = await connect(h, 'doc');
    const write = delayNext(async () => {});
    const set = h.local.set;
    h.local.set = async (key, value) => {
      if (key === 'tyrekick.assessments') await write.run();
      await set(key, value);
    };
    const clearing = h.background.onPopupMessage({ type: 'clear-data' });
    await write.started;
    await h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
    const requests = [...h.requests];
    write.release();
    await clearing;
    expect(requests).toEqual([]);
    expect(h.messagesFor('doc').at(-1)).toEqual({ type: 'status', active: true, generation: 1 });
    await h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
    await until(() => h.inFlight === 0 && storedEntries(h).length === 6);
    expect(h.requests).toHaveLength(1);
  });

  for (const controls of [['enable', 'pause'], ['pause', 'enable']] as const) {
    test(`an earlier ${controls[0]} completion cannot admit work during a later ${controls[1]}`, async () => {
      const h = await enabled();
      const nonce = await connect(h, 'doc');
      const preparation = delayNext(h.store.snapshot);
      h.store.snapshot = preparation.run;
      const preparing = h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
      await preparation.started;
      const firstWrite = delayNext(async () => {});
      const secondWrite = delayNext(async () => {});
      const set = h.local.set;
      let writes = 0;
      h.local.set = async (key, value) => {
        if (key === 'tyrekick.settings') await (++writes === 1 ? firstWrite.run() : secondWrite.run());
        await set(key, value);
      };
      const earlier = h.background.onPopupMessage({ type: controls[0] });
      await firstWrite.started;
      const later = h.background.onPopupMessage({ type: controls[1] });
      firstWrite.release();
      await secondWrite.started;
      await earlier;
      const before = h.posted.length;
      preparation.release();
      await preparing;
      await h.background.onPageMessage('doc', searchSync(nonce, cards(2, 47000000)));
      const requests = [...h.requests];
      const messages = h.posted.slice(before);
      secondWrite.release();
      await later;
      expect(requests).toEqual([]);
      expect(messages).toEqual([]);
      expect(h.messagesFor('doc').filter((message) => message.type === 'status')).toEqual([
        { type: 'status', active: true, generation: 0 },
        { type: 'status', active: controls[1] === 'enable', generation: 0 },
      ]);
    });
  }

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

describe('document lifecycle', () => {
  test('superseded in-flight warnings still cache independently without delivering to the old sync', async () => {
    const h = await enabled();
    h.hold(true);
    const nonce = await connect(h, 'doc');
    await h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
    await until(() => h.gates.length === 1);
    await h.background.onPageMessage('doc', searchSync(nonce, cards(2, 47000000)));
    await until(() => h.gates.length === 2);
    h.gates.shift()?.release();
    await until(() => storedEntries(h).length === 6);
    expect(priceDeliveries(h.messagesFor('doc'))).toEqual([]);
    expect(warningDeliveries(h.messagesFor('doc'))).toEqual([]);
    h.hold(false);
    h.gates.shift()?.release();
    await until(() => h.inFlight === 0 && storedEntries(h).length === 10 && warningDeliveries(h.messagesFor('doc')).length === 2);
    expect(warningDeliveries(h.messagesFor('doc')).map((delivery) => String(delivery.listingId))).toEqual(['47000000', '47000001']);
    expect(storedEntries(h).filter((entry) => entry.branch === 'warning')).toHaveLength(5);
  });

  test('pause also rejects a completed result waiting on its settings read', async () => {
    const h = await enabled();
    h.hold(true);
    const nonce = await connect(h, 'doc');
    await h.background.onPageMessage('doc', searchSync(nonce, cards(1)));
    await until(() => h.gates.length === 1);
    const held = delayNext(h.store.settings);
    h.store.settings = held.run;
    h.gates.shift()?.release();
    await held.started;
    await h.background.onPopupMessage({ type: 'pause' });
    const before = h.posted.length;
    held.release();
    await until(() => h.inFlight === 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.posted).toHaveLength(before);
  });

  test('a slower search cannot replace a newer sync', async () => {
    const h = await enabled();
    h.hold(true);
    const nonce = await connect(h, 'doc');
    const held = delayNext(crypto.subtle.digest.bind(crypto.subtle));
    const digest = spyOn(crypto.subtle, 'digest').mockImplementation(held.run);
    try {
      const preparing = h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
      await held.started;
      await h.background.onPageMessage('doc', searchSync(nonce, cards(2, 47000000)));
      held.release();
      await preparing;
      expect(h.requests).toHaveLength(1);
      expect(h.requests[0]?.price?.targetIds.map(String)).toEqual(['47000000', '47000001']);
    } finally {
      held.release();
      digest.mockRestore();
      h.hold(false);
      for (const gate of h.gates.splice(0)) gate.release();
      await until(() => h.inFlight === 0);
    }
  });

  test('a slower detail cannot post or schedule after a newer search', async () => {
    const h = await enabled();
    const nonce = await connect(h, 'doc');
    const held = delayNext(h.store.findOpening);
    h.store.findOpening = held.run;
    const preparing = h.background.onPageMessage('doc', {
      type: 'sync', documentNonce: nonce,
      page: { kind: 'detail', facts: facts({ id: '45000001' }), text: redact('Full service history.'), observedAt: NOW },
    });
    await held.started;
    await h.background.onPageMessage('doc', searchSync(nonce, cards(2, 47000000)));
    await until(() => h.inFlight === 0 && storedEntries(h).length === 4);
    const before = h.posted.length;
    held.release();
    await preparing;
    expect(h.requests).toHaveLength(1);
    expect(h.posted).toHaveLength(before);
  });

  for (const reconnect of [false, true]) {
    test(`a disconnected preparation cannot transmit${reconnect ? ' after reconnecting with the same id' : ''}`, async () => {
      const h = await enabled();
      const nonce = await connect(h, 'doc');
      const held = delayNext(h.store.snapshot);
      h.store.snapshot = held.run;
      const preparing = h.background.onPageMessage('doc', searchSync(nonce, cards(3)));
      await held.started;
      h.background.disconnect('doc');
      if (reconnect) await connect(h, 'doc');
      const before = h.posted.length;
      held.release();
      await preparing;
      expect(h.requests).toEqual([]);
      expect(h.posted).toHaveLength(before);
    });
  }
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

  test('newly revealed damage invalidates a ready originating search price', async () => {
    const h = await enabled();
    const target = await pricedSearch(h);
    expect(priceDeliveries(h.messagesFor('search'))[0]?.price).toMatchObject({ kind: 'assessed', assessment: { result: { kind: 'ready' } } });
    const nonce = await connect(h, 'damaged', { tabId: 8, openerTabId: 7 });
    await h.background.onPageMessage('damaged', detailSync(nonce, { ...target.facts, damageMentioned: true }, 'Accident damaged.'));
    expect(priceDeliveries(h.messagesFor('damaged'))[0]?.price).toEqual({ kind: 'no_search_context' });
    await until(() => warningDeliveries(h.messagesFor('damaged')).length === 1);
    expect(warningDeliveries(h.messagesFor('damaged'))[0]?.assessment.coverage).toBe('detail');
  });

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
