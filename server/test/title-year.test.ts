import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { PriceResultSchema } from '../../lib/contracts/assess';
import { classifyPage } from '../../lib/donedeal/page';
import { observeCards, readSearchData } from '../../lib/donedeal/search';
import { documentFrom, nextDataScript } from '../../tests/support/dom';
import { fixtureJson } from '../../tests/support/fixtures';
import { assessPrice } from '../src/pricing';

const SnapshotSchema = z.object({
  url: z.url(),
  cards: z.array(z.object({ href: z.string(), title: z.string(), meta: z.array(z.string()), price: z.string() })),
  nextData: z.unknown(),
});

function frozenGolf(title?: string) {
  const snapshot = SnapshotSchema.parse(fixtureJson('coverage/golf-default.json'));
  const location = new URL(snapshot.url);
  const route = classifyPage(location);
  if (route.kind !== 'search') throw new Error('expected a search snapshot');
  const doc = documentFrom(nextDataScript(snapshot.nextData), snapshot.url);
  for (const card of snapshot.cards) {
    const element = doc.createElement('article');
    element.className = 'Card-styled__Container-replay';
    const link = doc.createElement('a');
    link.href = card.href;
    link.textContent = title !== undefined && card.href.endsWith('/43069309') ? title : card.title;
    element.append(link);
    for (const item of card.meta) {
      const meta = doc.createElement('li');
      meta.className = 'SearchCard-styled__MetaInfoItem-replay';
      meta.textContent = item;
      element.append(meta);
    }
    const price = doc.createElement('span');
    price.className = 'Price-styled__Price-replay';
    price.textContent = card.price;
    element.append(price);
    doc.body.append(element);
  }
  const data = readSearchData({ doc, location, params: route.params, pathSegments: route.pathSegments });
  if (!data) throw new Error('snapshot search context was not verified');
  return observeCards(doc, data).map((card) => card.facts);
}

describe('title years in frozen search pricing', () => {
  test('the captured 2017 title and listed 2015 contradiction cannot receive or support a label', () => {
    const candidates = frozenGolf();
    const target = candidates.find((candidate) => candidate.listingId === '43069309');
    if (!target) throw new Error('captured listing is missing');
    expect(target).toMatchObject({ year: 2015, titleEvidence: { conflicts: ['year'] } });
    expect(PriceResultSchema.parse(assessPrice({ target, candidates }))).toMatchObject({
      kind: 'insufficient', reason: { code: 'conflicting_facts', fields: ['year'] },
    });
    for (const other of candidates) {
      const result = PriceResultSchema.parse(assessPrice({ target: other, candidates }));
      if (result.kind === 'ready' || result.kind === 'reference') {
        expect(result.comparables.some((comparable) => comparable.listingId === target.listingId)).toBe(false);
      }
    }
  });

  test.each(['VOKSWAGEN GOLF 1.2 TSI AUTO 2015', 'VOKSWAGEN GOLF 1.2 TSI AUTO NCT 19/03/2027'])(
    '%s preserves pricing when its title has no vehicle-year conflict', (title) => {
      const candidates = frozenGolf(title);
      const target = candidates.find((candidate) => candidate.listingId === '43069309');
      if (!target) throw new Error('captured listing is missing');
      expect(target).toMatchObject({ year: 2015, titleEvidence: { conflicts: [] } });
      expect(PriceResultSchema.parse(assessPrice({ target, candidates }))).toMatchObject({ kind: 'ready', label: 'expensive' });
    },
  );
});
