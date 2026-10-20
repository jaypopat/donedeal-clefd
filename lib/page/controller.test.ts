import { afterEach, expect, test } from 'bun:test';
import type { BackgroundMessage, PageMessage } from '../messages';
import { contentFingerprint, targetFingerprint, contextFingerprint } from '../contracts/fingerprint';
import type { CardView } from '../display/views';
import { documentFrom, nextDataScript } from '../../tests/support/dom';
import { fixtureJson, fixtureText } from '../../tests/support/fixtures';
import { createPageController, type MountedBadge } from './controller';

const stops: Array<() => void> = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); });
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await Bun.sleep(5); }
  throw new Error('Controller did not reach the expected state');
}
function setup() {
  let location = new URL('https://www.donedeal.ie/cars?area=Dublin');
  const doc = documentFrom(`${fixtureText('search-cards.html')}${nextDataScript(fixtureJson('search-next-data.json'))}`, location.href);
  const ports: Array<{ receive(message: unknown): void; lost(): void; sent: PageMessage[]; disconnected: boolean }> = [];
  const views = new Map<Element, CardView>();
  let deferMount: Promise<void> | null = null;
  const controller = createPageController({
    doc, location: () => location, now: Date.now,
    connect(receive, lost) {
      const port = { receive, lost, sent: [] as PageMessage[], disconnected: false };
      ports.push(port);
      return { postMessage: (message) => port.sent.push(message), disconnect: () => { port.disconnected = true; } };
    },
    async mount(anchor, initial) {
      if (deferMount) await deferMount;
      views.set(anchor, initial);
      const badge: MountedBadge = { update: (view) => { views.set(anchor, view); }, remove: () => { views.delete(anchor); } };
      return badge;
    },
  });
  stops.push(controller.stop);
  const port = () => { const value = ports.at(-1); if (!value) throw new Error('No port'); return value; };
  const sync = () => {
    const message = port().sent.findLast((entry) => entry.type === 'sync');
    if (!message || message.type !== 'sync' || message.page.kind !== 'search') throw new Error('No search submission');
    return { ...message, page: message.page };
  };
  return { controller, doc, ports, port, sync, views, navigate: (url: string) => { location = new URL(url); controller.locationChanged(); }, holdMount: (gate: Promise<void>) => { deferMount = gate; } };
}

async function warning(h: ReturnType<typeof setup>): Promise<BackgroundMessage> {
  const sync = h.sync();
  const card = sync.page.cards[0];
  if (!card) throw new Error('No card');
  return { type: 'warning', documentNonce: sync.documentNonce, deliveries: [{ listingId: card.facts.listingId, contentFp: await contentFingerprint({ ...card, coverage: 'card' }), assessment: { coverage: 'card', observedAt: Date.now(), reusedFromDetail: false, result: { kind: 'checked', findings: [] } } }] };
}

test('does not send listing observations or mount badges without consent', async () => {
  const h = setup();
  h.port().receive({ type: 'status', active: false, generation: 0 });
  h.controller.refresh();
  await Bun.sleep(100);
  expect(h.port().sent).toEqual([]);
  expect(h.views.size).toBe(0);
});

test('submits real DOM cards, redacted titles and both price and warning identities', async () => {
  const h = setup();
  h.port().receive({ type: 'status', active: true, generation: 0 });
  await until(() => h.views.size === 4);
  const sync = h.sync();
  expect(sync.page.cards.map((card) => String(card.facts.listingId))).toEqual(['37707120', '41839611', '42928524', '42864633']);
  const card = sync.page.cards[0];
  if (!card) throw new Error('No card');
  h.port().receive(await warning(h));
  expect([...h.views.values()][0]?.warning.kind).toBe('assessed');
  h.port().receive({ type: 'price', documentNonce: sync.documentNonce, deliveries: [{
    listingId: card.facts.listingId, targetFp: await targetFingerprint(card.facts),
    context: { contextId: sync.page.contextId, contextFp: await contextFingerprint(sync.page.cards.map((entry) => entry.facts)) },
    price: { kind: 'assessed', assessment: { result: { kind: 'insufficient', reason: { code: 'too_few_matches' }, matchCount: 0, unknownFactCount: 0 }, scope: 'this_search', observedAt: Date.now(), sampleSize: 4, loadedCount: 4 } },
  }] });
  expect([...h.views.values()][0]?.price.kind).toBe('assessed');
  h.controller.opened(card.facts.url);
  expect(h.port().sent.at(-1)).toMatchObject({ type: 'opened', opening: { listingId: card.facts.listingId, contextId: sync.page.contextId } });
});

test('clear and pause remove signals, rotate connections, and reject late deliveries', async () => {
  const h = setup();
  h.port().receive({ type: 'status', active: true, generation: 0 });
  await until(() => h.views.size === 4);
  const old = h.port();
  const late = await warning(h);
  old.receive({ type: 'status', active: true, generation: 1 });
  expect(h.views.size).toBe(0);
  expect(old.disconnected).toBe(true);
  old.receive(late);
  h.port().receive({ type: 'status', active: true, generation: 1 });
  await until(() => h.views.size === 4);
  h.port().receive(late);
  expect([...h.views.values()].every((view) => view.warning.kind === 'checking')).toBe(true);
  h.port().receive({ type: 'status', active: false, generation: 1 });
  expect(h.views.size).toBe(0);
});

test('search navigation resets context immediately and out-of-order reconciliations cannot restore old cards', async () => {
  const h = setup();
  h.port().receive({ type: 'status', active: true, generation: 0 });
  await until(() => h.views.size === 4);
  const previous = h.sync();
  const old = h.port();
  const late = await warning(h);
  h.navigate('https://www.donedeal.ie/cars?area=Cork');
  expect(h.views.size).toBe(0);
  h.port().receive({ type: 'status', active: true, generation: 0 });
  h.controller.refresh();
  h.doc.querySelector('article')?.remove();
  old.receive(late);
  await until(() => h.views.size === 4);
  expect(h.sync().page.contextId).not.toBe(previous.page.contextId);
  expect(h.sync().page.cards.every((card) => card.facts.make === null)).toBe(true);
});

test('reconnect resubmits missing work and cleanup prevents later mounts', async () => {
  const h = setup();
  h.port().receive({ type: 'status', active: true, generation: 0 });
  await until(() => h.views.size === 4);
  const previous = h.sync();
  h.port().lost();
  expect(h.views.size).toBe(0);
  await until(() => h.ports.length > 1);
  h.port().receive({ type: 'status', active: true, generation: 0 });
  h.port().receive({ type: 'status', active: true, generation: 0 });
  await until(() => h.views.size === 4);
  expect(h.sync().documentNonce).not.toBe(previous.documentNonce);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  h.holdMount(gate);
  h.navigate('https://www.donedeal.ie/cars?area=Kerry');
  h.port().receive({ type: 'status', active: true, generation: 0 });
  await Bun.sleep(100);
  h.controller.stop();
  release();
  await Bun.sleep(20);
  expect(h.views.size).toBe(0);
  expect(h.port().disconnected).toBe(true);
});
