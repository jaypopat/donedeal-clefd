import type { ListingFacts } from '../../lib/contracts/listing';
import { ListingFactsSchema } from '../../lib/contracts/listing';

type FactsInput = { id: string; eur?: number | null } & Partial<Omit<ListingFacts, 'listingId' | 'url'>>;

/** A Golf-like listing with every essential fact known, parsed through the real schema. */
export function facts({ id, eur = 15000, ...overrides }: FactsInput): ListingFacts {
  return ListingFactsSchema.parse({
    listingId: id,
    url: `https://www.donedeal.ie/cars-for-sale/example-car/${id}`,
    price: eur === null ? { kind: 'missing' } : { kind: 'cash', eur },
    year: 2018,
    mileage: { value: 90000, unit: 'km' },
    make: 'Volkswagen',
    model: 'Golf',
    fuel: 'diesel',
    transmission: 'manual',
    sellerType: 'dealer',
    engineLitres: 1.6,
    damageMentioned: false,
    ...overrides,
  });
}
