import type {
  AssessRequest,
  AssessResponse,
  BranchError,
  PriceResult,
  WarningResult,
  WarningTarget,
} from '../contracts/assess';
import type { ContentFp, ContextFp, ContextId, ListingId, TargetFp } from '../contracts/ids';
import type { ListingFacts } from '../contracts/listing';
import { ASSESS_SCHEMA_VERSION, LIMITS, POLICY } from '../contracts/versions';

export type DocId = string;

export type ContextSnapshot = {
  contextId: ContextId;
  contextFp: ContextFp;
  observedAt: number;
  candidates: ListingFacts[];
  loadedCount: number;
};

export type PriceJob = { key: string; listingId: ListingId; targetFp: TargetFp; facts: ListingFacts };
export type WarningJob = { key: string; contentFp: ContentFp; target: WarningTarget };

export type DocWork = {
  generation: number;
  price: { context: ContextSnapshot; jobs: PriceJob[] } | null;
  warnings: WarningJob[];
};

export type SendOutcome = { kind: 'response'; response: AssessResponse } | { kind: 'failed'; error: BranchError };

export type SchedulerDeps = {
  send(request: AssessRequest, signal: AbortSignal): Promise<SendOutcome>;
  onPrice(input: { subscribers: { docId: DocId; context: ContextSnapshot }[]; generation: number; context: ContextSnapshot; job: PriceJob; result: PriceResult }): void;
  onWarning(input: { docIds: DocId[]; generation: number; job: WarningJob; result: WarningResult }): void;
  maxInFlight?: number;
  maxTargets?: number;
};

type Batch = {
  controller: AbortController;
  generation: number;
  context: ContextSnapshot | null;
  priceJobs: PriceJob[];
  warningJobs: WarningJob[];
  subscribers: Map<string, Map<DocId, ContextSnapshot | null>>;
  cancelled: boolean;
};

export type Scheduler = ReturnType<typeof createScheduler>;

export function createScheduler(deps: SchedulerDeps) {
  const maxInFlight = deps.maxInFlight ?? LIMITS.maxConcurrentRequests;
  const maxTargets = deps.maxTargets ?? LIMITS.maxTargetsPerRequest;
  const queue = new Map<DocId, DocWork>();
  const inFlight = new Set<Batch>();

  function subscribeIfInFlight(key: string, docId: DocId, generation: number, context: ContextSnapshot | null): boolean {
    for (const batch of inFlight) {
      const subscribers = batch.subscribers.get(key);
      if (subscribers && batch.generation === generation) {
        subscribers.set(docId, context);
        return true;
      }
    }
    return false;
  }

  function nextBatch(): Batch | null {
    for (const [docId, work] of queue) {
      const priceJobs: PriceJob[] = [];
      const warningJobs: WarningJob[] = [];
      const listings = new Set<ListingId>();
      const fits = (listingId: ListingId) => listings.has(listingId) || listings.size < maxTargets;

      const remainingPrice: PriceJob[] = [];
      for (const job of work.price?.jobs ?? []) {
        if (subscribeIfInFlight(job.key, docId, work.generation, work.price?.context ?? null)) continue;
        if (fits(job.listingId)) {
          priceJobs.push(job);
          listings.add(job.listingId);
        } else remainingPrice.push(job);
      }
      const remainingWarnings: WarningJob[] = [];
      for (const job of work.warnings) {
        if (subscribeIfInFlight(job.key, docId, work.generation, null)) continue;
        if (fits(job.target.facts.listingId)) {
          warningJobs.push(job);
          listings.add(job.target.facts.listingId);
        } else remainingWarnings.push(job);
      }

      if (remainingPrice.length === 0 && remainingWarnings.length === 0) queue.delete(docId);
      else {
        const price = work.price && remainingPrice.length > 0 ? { context: work.price.context, jobs: remainingPrice } : null;
        queue.set(docId, { ...work, price, warnings: remainingWarnings });
      }
      if (priceJobs.length === 0 && warningJobs.length === 0) continue;

      const subscribers = new Map<string, Map<DocId, ContextSnapshot | null>>();
      for (const job of priceJobs) subscribers.set(job.key, new Map([[docId, work.price?.context ?? null]]));
      for (const job of warningJobs) subscribers.set(job.key, new Map([[docId, null]]));
      return {
        controller: new AbortController(),
        generation: work.generation,
        context: priceJobs.length > 0 ? (work.price?.context ?? null) : null,
        priceJobs,
        warningJobs,
        subscribers,
        cancelled: false,
      };
    }
    return null;
  }

  function requestFor(batch: Batch): AssessRequest {
    const context = batch.context;
    return {
      schemaVersion: ASSESS_SCHEMA_VERSION,
      requestId: crypto.randomUUID(),
      policy: POLICY,
      price:
        context && batch.priceJobs.length > 0
          ? {
              contextId: context.contextId,
              observedAt: context.observedAt,
              loadedCount: context.loadedCount,
              candidates: context.candidates,
              targetIds: batch.priceJobs.map((job) => job.listingId),
            }
          : null,
      warnings: batch.warningJobs.length > 0 ? { targets: batch.warningJobs.map((job) => job.target) } : null,
    };
  }

  function settle(batch: Batch, outcome: SendOutcome) {
    const docIds = (key: string) => [...(batch.subscribers.get(key)?.keys() ?? [])];
    const failure = outcome.kind === 'failed' ? outcome.error : 'invalid_response';
    const response = outcome.kind === 'response' ? outcome.response : null;
    if (batch.context) {
      const results = new Map(response?.price?.results.map((entry) => [entry.listingId, entry.result]));
      for (const job of batch.priceJobs) {
        const result = results.get(job.listingId) ?? { kind: 'unavailable', error: failure };
        const subscribers = [...(batch.subscribers.get(job.key) ?? [])].flatMap(([docId, context]) => context ? [{ docId, context }] : []);
        deps.onPrice({ subscribers, generation: batch.generation, context: batch.context, job, result });
      }
    }
    const warnings = new Map(response?.warnings?.results.map((entry) => [entry.listingId, entry.result]));
    for (const job of batch.warningJobs) {
      const result = warnings.get(job.target.facts.listingId) ?? { kind: 'unavailable', error: failure };
      deps.onWarning({ docIds: docIds(job.key), generation: batch.generation, job, result });
    }
  }

  async function run(batch: Batch) {
    inFlight.add(batch);
    let outcome: SendOutcome;
    try {
      outcome = await deps.send(requestFor(batch), batch.controller.signal);
    } catch {
      outcome = { kind: 'failed', error: 'internal' };
    }
    inFlight.delete(batch);
    if (!batch.cancelled) settle(batch, outcome);
    pump();
  }

  function pump() {
    while (inFlight.size < maxInFlight) {
      const batch = nextBatch();
      if (!batch) return;
      void run(batch);
    }
  }

  return {
    replace(docId: DocId, work: DocWork) {
      queue.set(docId, work);
      pump();
    },
    drop(docId: DocId) {
      queue.delete(docId);
      for (const batch of inFlight) for (const subscribers of batch.subscribers.values()) subscribers.delete(docId);
    },
    cancelAll() {
      queue.clear();
      for (const batch of inFlight) {
        batch.cancelled = true;
        batch.controller.abort();
      }
      inFlight.clear();
    },
    get inFlightCount() {
      return inFlight.size;
    },
  };
}
