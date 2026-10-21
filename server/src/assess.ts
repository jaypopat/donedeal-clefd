import type {
  AssessRequest,
  AssessResponse,
  PriceResult,
  PriceTargetResult,
  PriceWork,
  WarningResult,
  WarningTargetResult,
  WarningWork,
} from '../../lib/contracts/assess';
import { contentFingerprint, contextFingerprint, targetFingerprint } from '../../lib/contracts/fingerprint';
import { ASSESS_SCHEMA_VERSION, POLICY } from '../../lib/contracts/versions';
import type { Meter, ModelGateway } from './models/gateway';
import { assessPrice } from './pricing';
import { assessWarning } from './warnings/assess';

const WARNING_CONCURRENCY = 4;

export type AssessDeps = {
  gateway: ModelGateway | null;
  now: () => number;
  meter: Meter;
};

async function mapLimited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (item !== undefined) results[index] = await work(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

async function priceBranch(work: PriceWork): Promise<NonNullable<AssessResponse['price']>> {
  const targetIds = new Set(work.targetIds);
  const targets = work.candidates.filter((candidate) => targetIds.has(candidate.listingId));
  const results = await Promise.all(
    targets.map(async (target): Promise<PriceTargetResult> => {
      let result: PriceResult;
      try {
        result = assessPrice({ target, candidates: work.candidates });
      } catch {
        result = { kind: 'unavailable', error: 'internal' };
      }
      return { listingId: target.listingId, targetFp: await targetFingerprint(target), result };
    }),
  );
  return { contextId: work.contextId, contextFp: await contextFingerprint(work.candidates), observedAt: work.observedAt, results };
}

async function warningBranch(work: WarningWork, deps: AssessDeps): Promise<NonNullable<AssessResponse['warnings']>> {
  const { gateway } = deps;
  const results = await mapLimited(work.targets, WARNING_CONCURRENCY, async (target): Promise<WarningTargetResult> => {
    const result: WarningResult = gateway
      ? await assessWarning({ target, gateway, meter: deps.meter })
      : { kind: 'unavailable', error: 'service_unavailable' };
    return {
      listingId: target.facts.listingId,
      contentFp: await contentFingerprint(target),
      coverage: target.coverage,
      observedAt: target.observedAt,
      result,
    };
  });
  return { results };
}

export async function assess(request: AssessRequest, deps: AssessDeps): Promise<AssessResponse> {
  const [price, warnings] = await Promise.all([
    request.price ? priceBranch(request.price) : null,
    request.warnings ? warningBranch(request.warnings, deps) : null,
  ]);
  return {
    schemaVersion: ASSESS_SCHEMA_VERSION,
    requestId: request.requestId,
    policy: POLICY,
    assessedAt: deps.now(),
    price,
    warnings,
  };
}
