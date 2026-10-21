import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { classifyPage } from '../lib/donedeal/page';
import { observeCards, readSearchData } from '../lib/donedeal/search';
import { LIMITS, POLICY } from '../lib/contracts/versions';
import { assessPrice } from '../server/src/pricing';
import { documentFrom, nextDataScript } from '../tests/support/dom';

const SnapshotSchema = z.object({
  url: z.url(),
  capturedAt: z.iso.datetime(),
  cards: z.array(z.strictObject({ href: z.string(), title: z.string(), meta: z.array(z.string()), price: z.string() })),
  nextData: z.unknown(),
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function report(path: string) {
  const snapshot = SnapshotSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const location = new URL(snapshot.url);
  const route = classifyPage(location);
  if (route.kind !== 'search') throw new Error(`Not a search snapshot: ${path}`);
  const html = snapshot.cards.map((card) => `<article class="Card-styled__Container-replay"><h3><a href="${escapeHtml(card.href)}">${escapeHtml(card.title)}</a></h3><ul>${card.meta.map((item) => `<li class="SearchCard-styled__MetaInfoItem-replay">${escapeHtml(item)}</li>`).join('')}</ul><div class="Price-styled__Wrapper-replay"><span class="Price-styled__Price-replay">${escapeHtml(card.price)}</span></div></article>`).join('');
  const doc = documentFrom(`${html}${nextDataScript(snapshot.nextData)}`, snapshot.url);
  const data = readSearchData({ doc, location, params: route.params, pathSegments: route.pathSegments });
  if (!data) throw new Error(`Snapshot query is not verified: ${path}`);
  const candidates = observeCards(doc, data).slice(0, LIMITS.maxCandidates).map((card) => card.facts);
  const loaded = new Set(candidates.map((candidate) => candidate.listingId));
  const counts: Record<string, number> = {};
  const listings = candidates.map((target) => {
    const result = assessPrice({ target, candidates });
    const outcome = result.kind === 'ready' ? result.label : result.kind === 'insufficient' ? result.reason.code : result.kind;
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    if (result.kind === 'ready') {
      if (result.matchCount < 5) throw new Error('A price label has fewer than five matches');
      if (result.comparables.some((item) => !loaded.has(item.listingId) || item.listingId === target.listingId)) throw new Error('A comparison is not another loaded listing');
    }
    return { facts: target, result };
  });
  return { snapshot: path, capturedAt: snapshot.capturedAt, url: snapshot.url, cards: candidates.length, counts, listings };
}

const directory = join(import.meta.dir, '../fixtures/donedeal/coverage');
const reports = readdirSync(directory).filter((file) => file.endsWith('.json')).sort().map((file) => report(join(directory, file)));
console.log(JSON.stringify({ policy: POLICY.pricing, reports }, null, 2));
