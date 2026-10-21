import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { parseListingHref } from '../contracts/ids';
import { documentFrom, nextDataScript } from '../../tests/support/dom';
import { fixtureJson, fixtureText } from '../../tests/support/fixtures';
import { observeDetail } from './detail';

const AQUA_URL = 'https://www.donedeal.ie/cars-for-sale/2016-toyota-aqua-1-5-hybrid-automatic-finance/42864633';

function detailPage(url: string) {
  const listing = parseListingHref(url);
  if (!listing) throw new Error('bad listing url');
  const doc = documentFrom(
    `${fixtureText('detail-price.html')}${nextDataScript(fixtureJson('detail-next-data.json'))}`,
    url,
  );
  return observeDetail(doc, listing);
}

describe('detail page', () => {
  test('records limited coverage when a long description exceeds the text budget', () => {
    const listing = parseListingHref(AQUA_URL);
    if (!listing) throw new Error('bad listing url');
    const data = z.object({ props: z.object({ pageProps: z.record(z.string(), z.unknown()) }) }).parse(fixtureJson('detail-next-data.json'));
    const changed = { props: { pageProps: { ...data.props.pageProps, description: 'Ordinary listing text. '.repeat(250) + 'Send a deposit before viewing.' } } };
    const doc = documentFrom(`${fixtureText('detail-price.html')}${nextDataScript(changed)}`, AQUA_URL);
    const detail = observeDetail(doc, listing);
    expect(detail?.coverage).toBe('detail_partial');
    expect(detail?.text).not.toContain('Send a deposit');
  });

  test('reads named vehicle attributes, seller type and the cash price', () => {
    expect<unknown>(detailPage(AQUA_URL)?.facts).toEqual({
      listingId: '42864633',
      url: AQUA_URL,
      price: { kind: 'cash', eur: 10495 },
      year: 2016,
      mileage: { value: 68000, unit: 'km' },
      make: 'Toyota',
      model: 'Aqua',
      fuel: 'petrol_hybrid',
      transmission: 'automatic',
      sellerType: 'dealer',
      engineLitres: 1.5,
      damageMentioned: false,
    });
  });

  test('includes the title and description as redacted text', () => {
    expect<unknown>(detailPage(AQUA_URL)?.text).toBe(
      '2016 TOYOTA AQUA 1.5 HYBRID AUTOMATIC *FINANCE*\n\nFull service history. Viewing is available before payment.',
    );
  });

  test('rejects embedded data that belongs to another listing', () => {
    expect(detailPage('https://www.donedeal.ie/cars-for-sale/some-other-car/42864634')).toBeNull();
  });

  test('mounts beside the headline price row', () => {
    expect(detailPage(AQUA_URL)?.anchor.className).toStartWith('AdTitleBox-styled__PriceRow-');
  });
});
