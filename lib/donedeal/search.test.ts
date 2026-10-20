import { describe, expect, test } from 'bun:test';
import { documentFrom, nextDataScript } from '../../tests/support/dom';
import { fixtureJson, fixtureText } from '../../tests/support/fixtures';
import { classifyPage } from './page';
import { observeCards, readSearchData } from './search';

function searchPage(url: string, nextData: unknown) {
  const location = new URL(url);
  const route = classifyPage(location);
  if (route.kind !== 'search') throw new Error(`not a search route: ${url}`);
  const doc = documentFrom(`${fixtureText('search-cards.html')}${nextDataScript(nextData)}`, url);
  const data = readSearchData({ doc, location, params: route.params, pathSegments: route.pathSegments });
  return { data, cards: observeCards(doc, data) };
}

describe('search cards', () => {
  test('enumerates every rendered card, including promoted cards absent from page data', () => {
    const { cards } = searchPage('https://www.donedeal.ie/cars?area=Dublin', fixtureJson('search-next-data.json'));
    expect(cards.map((card) => String(card.facts.listingId))).toEqual(['37707120', '41839611', '42928524', '42864633']);
    expect(cards.map((card) => String(card.facts.url))).toEqual([
      'https://www.donedeal.ie/cars-for-sale/ford-explorer-select-77kwh-extended-range/37707120',
      'https://www.donedeal.ie/cars-for-sale/mercedes-benz-gle-500e-amg-line-premium-stunning/41839611',
      'https://www.donedeal.ie/cars-for-sale/ford-ranger-2026-ranger-wildtrak-3-0-v6-diesel-ca/42928524',
      'https://www.donedeal.ie/cars-for-sale/2016-toyota-aqua-1-5-hybrid-automatic-finance/42864633',
    ]);
  });

  test('keeps the cash asking price when a monthly finance offer is also displayed', () => {
    const { cards } = searchPage('https://www.donedeal.ie/cars?area=Dublin', fixtureJson('search-next-data.json'));
    const [, mercedes, , toyota] = cards;
    expect(mercedes?.facts.price).toEqual({ kind: 'cash', eur: 29950 });
    expect(toyota?.facts.price).toEqual({ kind: 'cash', eur: 10495 });
  });

  test('reads structured card facts and leaves unevidenced facts unknown', () => {
    const { cards } = searchPage('https://www.donedeal.ie/cars?area=Dublin', fixtureJson('search-next-data.json'));
    const [explorer, mercedes, ranger, toyota] = cards;
    expect(explorer?.facts).toMatchObject({ year: 2026, fuel: 'electric', mileage: null, sellerType: null, make: null });
    expect(mercedes?.facts).toMatchObject({
      year: 2016,
      fuel: 'petrol_plugin_hybrid',
      engineLitres: 3,
      mileage: { value: 86000, unit: 'km' },
    });
    expect(ranger?.facts.mileage).toEqual({ value: 5, unit: 'km' });
    expect(toyota?.facts).toMatchObject({
      year: 2016,
      fuel: 'petrol_hybrid',
      engineLitres: 1.5,
      mileage: { value: 68000, unit: 'km' },
      sellerType: 'dealer',
      make: null,
      model: null,
      transmission: null,
    });
  });

  test('applies make, model and transmission filters only to organic results', () => {
    const { cards } = searchPage(
      'https://www.donedeal.ie/cars/Toyota/Aqua?transmission=Automatic',
      fixtureJson('search-next-data-toyota-aqua-automatic.json'),
    );
    const toyota = cards.find((card) => card.facts.listingId === '42864633');
    const promoted = cards.filter((card) => card.facts.listingId !== '42864633');
    expect(toyota?.facts).toMatchObject({ make: 'Toyota', model: 'Aqua', transmission: 'automatic' });
    expect(promoted.every((card) => card.facts.make === null && card.facts.transmission === null)).toBe(true);
  });

  test('ignores embedded data that belongs to a different search', () => {
    const { data, cards } = searchPage('https://www.donedeal.ie/cars?area=Cork', fixtureJson('search-next-data.json'));
    expect(data).toBeNull();
    expect(cards.find((card) => card.facts.listingId === '42864633')?.facts.sellerType).toBeNull();
  });

  test('carries only allowlisted facts and a redacted title', () => {
    const { cards } = searchPage('https://www.donedeal.ie/cars?area=Dublin', fixtureJson('search-next-data.json'));
    const toyota = cards.find((card) => card.facts.listingId === '42864633');
    expect<unknown>(toyota?.text).toBe('2016 TOYOTA AQUA 1.5 HYBRID AUTOMATIC *FINANCE*');
    const serialised = JSON.stringify(cards.map((card) => card.facts));
    expect(serialised).not.toContain('Dublin');
    expect(serialised).not.toContain('4.9');
    expect(serialised).not.toContain('warranty');
  });

  test('mounts next to the price wrapper inside the card', () => {
    const { cards } = searchPage('https://www.donedeal.ie/cars?area=Dublin', fixtureJson('search-next-data.json'));
    expect(cards.every((card) => card.anchor.className.startsWith('Price-styled__Wrapper-'))).toBe(true);
    expect(cards.every((card) => card.element.contains(card.anchor))).toBe(true);
  });
});

describe('search routes', () => {
  test('filtering, sorting and paging produce distinct search keys; tracking does not', () => {
    const key = (url: string) => {
      const route = classifyPage(new URL(url));
      return route.kind === 'search' ? route.searchKey : null;
    };
    const base = key('https://www.donedeal.ie/cars/Volkswagen/Polo?area=Dublin');
    expect(key('https://www.donedeal.ie/cars/Volkswagen/Polo?area=Dublin&utm_source=x')).toBe(base);
    expect(key('https://www.donedeal.ie/cars/Volkswagen/Polo?area=Dublin&sort=priceasc')).not.toBe(base);
    expect(key('https://www.donedeal.ie/cars/Volkswagen/Polo?area=Dublin&start=30')).not.toBe(base);
    expect(key('https://www.donedeal.ie/cars/Volkswagen/Polo?area=Dublin&transmission=Manual')).not.toBe(base);
  });

  test('recognises ad pages and rejects other hosts', () => {
    expect<unknown>(classifyPage(new URL('https://www.donedeal.ie/cars-for-sale/x-y/42864633'))).toEqual({
      kind: 'detail',
      listing: { id: '42864633', url: 'https://www.donedeal.ie/cars-for-sale/x-y/42864633' },
    });
    expect(classifyPage(new URL('http://www.donedeal.ie/cars')).kind).toBe('unsupported');
    expect(classifyPage(new URL('https://donedeal.example/cars')).kind).toBe('unsupported');
    expect(classifyPage(new URL('https://www.donedeal.ie/motorbikes')).kind).toBe('unsupported');
  });
});
