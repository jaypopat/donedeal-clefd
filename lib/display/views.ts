import type { ListingId, ListingUrl } from '../contracts/ids';
import type { Coverage } from '../contracts/listing';
import type { PriceAssessment, WarningAssessment } from '../messages';

export type PriceView =
  | { kind: 'checking' }
  | { kind: 'assessed'; assessment: PriceAssessment }
  | { kind: 'no_search_context' }
  | { kind: 'outside_sample'; sampleSize: number };

export type WarningView = { kind: 'checking' } | { kind: 'assessed'; assessment: WarningAssessment };

export type CardView = {
  listingId: ListingId;
  url: ListingUrl;
  coverage: Coverage;
  price: PriceView;
  warning: WarningView;
};
