import type { WarningTarget } from '../contracts/assess';
import type { DocumentNonce } from '../contracts/ids';
import { contentFingerprint, contextFingerprint, targetFingerprint } from '../contracts/fingerprint';
import { LIMITS } from '../contracts/versions';
import type {
  BackgroundMessage,
  DetailSync,
  Opening,
  PriceDelivery,
  SearchSync,
  WarningDelivery,
} from '../messages';
import { PageMessageSchema, PopupRequestSchema } from '../messages';
import type { Cache, PriceEntry } from './cache';
import { samePriceIdentity, findPrice, findWarning, freshDetailWarning, priceKey, warningKey } from './cache';
import type { ContextSnapshot, DocId, PriceJob, SchedulerDeps, WarningJob } from './scheduler';
import { createScheduler } from './scheduler';
import type { PopupState, Settings } from './settings';
import { enable, isActive, pause } from './settings';
import type { Store } from './store';

type CleanupAlarms = {
  get(name: string): Promise<unknown>;
  create(name: string, info: { periodInMinutes: number }): Promise<void>;
  onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
};

export async function startCacheCleanup(store: Pick<Store, 'snapshot'>, alarms: CleanupAlarms) {
  const name = 'tyrekick-cache-expiry';
  alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === name) void store.snapshot();
  });
  await store.snapshot();
  if (!await alarms.get(name)) await alarms.create(name, { periodInMinutes: 1 });
}

export type PageDoc = { id: DocId; tabId: number; openerTabId: number | null; documentNonce: DocumentNonce | null };

type ConnectedDoc = PageDoc & { revision: number };
type SyncOperation = { doc: ConnectedDoc; revision: number; epoch: number };

export type BackgroundDeps = {
  store: Store;
  send: SchedulerDeps['send'];
  post(docId: DocId, message: BackgroundMessage): void;
  now(): number;
};

export function createBackground(deps: BackgroundDeps) {
  const docs = new Map<DocId, ConnectedDoc>();
  let controlEpoch = 0;
  let controlPending = false;

  function isCurrent(operation: SyncOperation) {
    return (
      !controlPending && operation.epoch === controlEpoch && docs.get(operation.doc.id) === operation.doc
      && operation.revision === operation.doc.revision
    );
  }

  function recipients(docIds: readonly DocId[]): SyncOperation[] {
    return docIds.flatMap((docId) => {
      const doc = docs.get(docId);
      return doc ? [{ doc, revision: doc.revision, epoch: controlEpoch }] : [];
    });
  }

  function deliverPrice(operations: readonly SyncOperation[], delivery: PriceDelivery) {
    for (const operation of operations) {
      const { doc } = operation;
      if (isCurrent(operation) && doc.documentNonce) {
        deps.post(doc.id, { type: 'price', documentNonce: doc.documentNonce, deliveries: [delivery] });
      }
    }
  }

  function deliverWarning(operations: readonly SyncOperation[], delivery: WarningDelivery) {
    for (const operation of operations) {
      const { doc } = operation;
      if (isCurrent(operation) && doc.documentNonce) {
        deps.post(doc.id, { type: 'warning', documentNonce: doc.documentNonce, deliveries: [delivery] });
      }
    }
  }

  const scheduler = createScheduler({
    send: deps.send,
    onPrice({ subscribers, generation, context, job, result }) {
      const deliveries = subscribers.map((subscriber) => ({ ...subscriber, operations: recipients([subscriber.docId]) }));
      const assessment = {
        result,
        scope: 'this_search' as const,
        observedAt: context.observedAt,
        sampleSize: context.candidates.length,
        loadedCount: context.loadedCount,
      };
      if (result.kind !== 'unavailable') {
        const entry: PriceEntry = {
          branch: 'price',
          key: job.key,
          listingId: job.listingId,
          storedAt: deps.now(),
          facts: job.facts,
          context: { contextId: context.contextId, contextFp: context.contextFp },
          targetFp: job.targetFp,
          assessment: { ...assessment, result },
        };
        void deps.store.put(entry, generation);
      }
      void currentGeneration().then((current) => {
        if (current !== generation) return;
        for (const subscriber of deliveries) {
          deliverPrice(subscriber.operations, {
            listingId: job.listingId,
            targetFp: job.targetFp,
            context: { contextId: subscriber.context.contextId, contextFp: subscriber.context.contextFp },
            price: {
              kind: 'assessed',
              assessment: { ...assessment, observedAt: subscriber.context.observedAt, loadedCount: subscriber.context.loadedCount },
            },
          });
        }
      });
    },
    onWarning({ docIds, generation, job, result }) {
      const operations = recipients(docIds);
      const assessment = { result, coverage: job.target.coverage, observedAt: job.target.observedAt, reusedFromDetail: false };
      if (result.kind === 'checked') {
        void deps.store.put(
          {
            branch: 'warning',
            key: job.key,
            listingId: job.target.facts.listingId,
            storedAt: deps.now(),
            facts: job.target.facts,
            contentFp: job.contentFp,
            assessment: { ...assessment, result },
          },
          generation,
        );
      }
      void currentGeneration().then((current) => {
        if (current !== generation) return;
        deliverWarning(operations, { listingId: job.target.facts.listingId, contentFp: job.contentFp, assessment });
      });
    },
  });

  async function currentGeneration(): Promise<number | null> {
    const settings = await deps.store.settings();
    return isActive(settings) ? settings.generation : null;
  }

  function status(settings: Settings): BackgroundMessage {
    return { type: 'status', active: isActive(settings), generation: settings.generation };
  }

  function broadcast(settings: Settings) {
    for (const docId of docs.keys()) deps.post(docId, status(settings));
  }

  async function warningWork(input: {
    cache: Cache;
    target: WarningTarget;
    deliveries: WarningDelivery[];
    jobs: WarningJob[];
  }) {
    const { target } = input;
    const now = deps.now();
    const contentFp = await contentFingerprint(target);
    const listingId = target.facts.listingId;
    const enrichment = target.coverage === 'card' ? freshDetailWarning(input.cache, target.facts, now) : null;
    if (enrichment) {
      input.deliveries.push({ listingId, contentFp, assessment: { ...enrichment.assessment, reusedFromDetail: true } });
      return;
    }
    const key = warningKey({ listingId, contentFp, coverage: target.coverage });
    const hit = findWarning(input.cache, key, now);
    if (hit) input.deliveries.push({ listingId, contentFp, assessment: hit.assessment });
    else input.jobs.push({ key, contentFp, target });
  }

  async function syncSearch(operation: SyncOperation, sync: SearchSync, settings: Settings, cache: Cache) {
    const { doc } = operation;
    const now = deps.now();
    const sample = sync.cards.slice(0, LIMITS.maxCandidates);
    const context: ContextSnapshot = {
      contextId: sync.contextId,
      contextFp: await contextFingerprint(sample.map((card) => card.facts)),
      observedAt: sync.observedAt,
      candidates: sample.map((card) => card.facts),
      loadedCount: sync.cards.length,
    };
    const visible = new Set(sync.visible);
    const ordered = [...sync.cards].sort((a, b) => Number(visible.has(b.facts.listingId)) - Number(visible.has(a.facts.listingId)));
    const inSample = new Set(sample.map((card) => card.facts.listingId));
    const priceDeliveries: PriceDelivery[] = [];
    const warningDeliveries: WarningDelivery[] = [];
    const priceJobs: PriceJob[] = [];
    const warningJobs: WarningJob[] = [];

    for (const card of ordered) {
      const { listingId } = card.facts;
      if (inSample.has(listingId)) {
        const targetFp = await targetFingerprint(card.facts);
        const key = priceKey({ listingId, targetFp, contextFp: context.contextFp });
        const hit = findPrice(cache, key, now);
        if (hit) {
          priceDeliveries.push({
            listingId,
            targetFp,
            context: { contextId: context.contextId, contextFp: context.contextFp },
            price: {
              kind: 'assessed',
              assessment: { ...hit.assessment, observedAt: context.observedAt, loadedCount: context.loadedCount },
            },
          });
        } else priceJobs.push({ key, listingId, targetFp, facts: card.facts });
      }
      const target: WarningTarget = { facts: card.facts, coverage: 'card', text: card.text, observedAt: sync.observedAt };
      await warningWork({ cache, target, deliveries: warningDeliveries, jobs: warningJobs });
    }

    if (!isCurrent(operation)) return;
    if (doc.documentNonce) {
      if (priceDeliveries.length > 0) deps.post(doc.id, { type: 'price', documentNonce: doc.documentNonce, deliveries: priceDeliveries });
      if (warningDeliveries.length > 0) deps.post(doc.id, { type: 'warning', documentNonce: doc.documentNonce, deliveries: warningDeliveries });
    }
    scheduler.replace(doc.id, {
      generation: settings.generation,
      price: priceJobs.length > 0 ? { context, jobs: priceJobs } : null,
      warnings: warningJobs,
    });
  }

  async function originatingPrice(doc: PageDoc, sync: DetailSync, cache: Cache): Promise<PriceDelivery['price']> {
    const tabs = doc.openerTabId === null ? [doc.tabId] : [doc.tabId, doc.openerTabId];
    const opening = await deps.store.findOpening(sync.facts.listingId, tabs);
    if (!opening) return { kind: 'no_search_context' };
    const entry = findPrice(cache, priceKey(opening), deps.now());
    if (!entry || !samePriceIdentity(entry.facts, sync.facts)) return { kind: 'no_search_context' };
    return { kind: 'assessed', assessment: { ...entry.assessment, scope: 'originating_search' } };
  }

  async function syncDetail(operation: SyncOperation, sync: DetailSync, settings: Settings, cache: Cache) {
    const { doc } = operation;
    const price = await originatingPrice(doc, sync, cache);
    const targetFp = await targetFingerprint(sync.facts);
    const deliveries: WarningDelivery[] = [];
    const jobs: WarningJob[] = [];
    const target: WarningTarget = { facts: sync.facts, coverage: sync.coverage, text: sync.text, observedAt: sync.observedAt };
    await warningWork({ cache, target, deliveries, jobs });
    if (!isCurrent(operation)) return;
    if (doc.documentNonce) {
      deps.post(doc.id, {
        type: 'price',
        documentNonce: doc.documentNonce,
        deliveries: [{ listingId: sync.facts.listingId, targetFp, context: null, price }],
      });
    }
    if (doc.documentNonce && deliveries.length > 0) deps.post(doc.id, { type: 'warning', documentNonce: doc.documentNonce, deliveries });
    scheduler.replace(doc.id, { generation: settings.generation, price: null, warnings: jobs });
  }

  async function recordOpening(doc: PageDoc, opening: Opening) {
    const settings = await deps.store.settings();
    await deps.store.recordOpening({ ...opening, sourceTabId: doc.tabId }, settings.generation);
  }

  async function popupState(settings: Settings): Promise<PopupState> {
    const { cache } = await deps.store.snapshot();
    return { access: settings.access.kind, cachedAssessments: cache.entries.length };
  }

  return {
    async connect(doc: PageDoc) {
      const connected: ConnectedDoc = { ...doc, revision: 0 };
      docs.set(doc.id, connected);
      scheduler.drop(doc.id);
      const epoch = controlEpoch;
      const { settings } = await deps.store.snapshot();
      if (docs.get(doc.id) === connected && epoch === controlEpoch && !controlPending) deps.post(doc.id, status(settings));
    },

    disconnect(docId: DocId) {
      docs.delete(docId);
      scheduler.drop(docId);
    },

    async onPageMessage(docId: DocId, raw: unknown) {
      const doc = docs.get(docId);
      const message = PageMessageSchema.safeParse(raw);
      if (!doc || !message.success) return;
      if (doc.documentNonce && doc.documentNonce !== message.data.documentNonce) return;
      doc.documentNonce = message.data.documentNonce;
      if (message.data.type === 'opened') {
        await recordOpening(doc, message.data.opening);
        return;
      }
      const operation: SyncOperation = { doc, revision: ++doc.revision, epoch: controlEpoch };
      scheduler.drop(docId);
      if (controlPending) return;
      const { settings, cache } = await deps.store.snapshot();
      if (!isCurrent(operation)) return;
      if (!isActive(settings)) {
        deps.post(docId, status(settings));
        return;
      }
      const page = message.data.page;
      if (page.kind === 'search') await syncSearch(operation, page, settings, cache);
      else await syncDetail(operation, page, settings, cache);
    },

    async onPopupMessage(raw: unknown): Promise<PopupState | null> {
      const request = PopupRequestSchema.safeParse(raw);
      if (!request.success) return null;
      switch (request.data.type) {
        case 'get-state':
          return popupState(await deps.store.settings());
        case 'enable':
        case 'pause':
        case 'clear-data': {
          const epoch = ++controlEpoch;
          controlPending = true;
          scheduler.cancelAll();
          const settings = await (request.data.type === 'clear-data'
            ? deps.store.clear()
            : deps.store.updateSettings(request.data.type === 'pause' ? pause : (current) => enable(current, deps.now())));
          if (epoch === controlEpoch) {
            controlPending = false;
            broadcast(settings);
          }
          return popupState(settings);
        }
        default: {
          const _exhaustive: never = request.data;
          return _exhaustive;
        }
      }
    },
  };
}
