import { z } from 'zod';
import type { ListingId } from '../contracts/ids';
import { EpochMsSchema } from '../contracts/ids';
import { LIMITS } from '../contracts/versions';
import type { Opening } from '../messages';
import { OpeningSchema } from '../messages';
import type { Cache, CacheEntry } from './cache';
import { CacheSchema, emptyCache, pruneCache, withEntry } from './cache';
import type { Settings } from './settings';
import { DEFAULT_SETTINGS, SettingsSchema, isActive } from './settings';

/** The subset of `chrome.storage` areas the store needs. */
export type StorageArea = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
};

const SETTINGS_KEY = 'tyrekick.settings';
const CACHE_KEY = 'tyrekick.assessments';
const OPENINGS_KEY = 'tyrekick.openings';

const RecordedOpeningSchema = OpeningSchema.extend({ sourceTabId: z.int().min(0), openedAt: EpochMsSchema });
export type RecordedOpening = z.infer<typeof RecordedOpeningSchema>;

const OpeningsSchema = z.strictObject({
  version: z.literal(1),
  generation: z.int().min(0),
  entries: z.array(RecordedOpeningSchema).max(LIMITS.maxOpenings),
});
type Openings = z.infer<typeof OpeningsSchema>;

export type Store = ReturnType<typeof createStore>;

/**
 * The background's only storage writer. Writes run one at a time, and each write
 * that carries a generation is dropped once a clear has moved past it.
 */
export function createStore(deps: { local: StorageArea; session: StorageArea; now: () => number }) {
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = tail.then(operation);
    tail = run.catch(() => undefined);
    return run;
  }

  async function settings(): Promise<Settings> {
    const parsed = SettingsSchema.safeParse(await deps.local.get(SETTINGS_KEY));
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  async function cache(generation: number): Promise<Cache> {
    const parsed = CacheSchema.safeParse(await deps.local.get(CACHE_KEY));
    return parsed.success && parsed.data.generation === generation ? parsed.data : emptyCache(generation);
  }

  async function openings(generation: number): Promise<Openings> {
    const parsed = OpeningsSchema.safeParse(await deps.session.get(OPENINGS_KEY));
    const fresh = parsed.success && parsed.data.generation === generation ? parsed.data.entries : [];
    const now = deps.now();
    return { version: 1, generation, entries: fresh.filter((entry) => now - entry.openedAt < LIMITS.openingTtlMs) };
  }

  return {
    settings,

    async snapshot(): Promise<{ settings: Settings; cache: Cache }> {
      const current = await settings();
      const stored = await cache(current.generation);
      if (pruneCache(stored, deps.now()).entries.length === stored.entries.length) {
        return { settings: current, cache: stored };
      }
      return serial(async () => {
        const latest = await settings();
        const stored = await cache(latest.generation);
        const fresh = pruneCache(stored, deps.now());
        if (fresh.entries.length !== stored.entries.length) await deps.local.set(CACHE_KEY, fresh);
        return { settings: latest, cache: fresh };
      });
    },

    updateSettings(update: (current: Settings) => Settings): Promise<Settings> {
      return serial(async () => {
        const next = update(await settings());
        await deps.local.set(SETTINGS_KEY, next);
        return next;
      });
    },

    clear(): Promise<Settings> {
      return serial(async () => {
        const current = await settings();
        const next: Settings = { ...current, generation: current.generation + 1 };
        await deps.local.set(SETTINGS_KEY, next);
        await deps.local.set(CACHE_KEY, emptyCache(next.generation));
        await deps.session.remove(OPENINGS_KEY);
        return next;
      });
    },

    /** Returns false when the result arrived after a clear or pause and was discarded. */
    put(entry: CacheEntry, generation: number): Promise<boolean> {
      return serial(async () => {
        const current = await settings();
        if (current.generation !== generation || !isActive(current)) return false;
        await deps.local.set(CACHE_KEY, withEntry(await cache(generation), entry, deps.now()));
        return true;
      });
    },

    recordOpening(opening: Opening & { sourceTabId: number }, generation: number): Promise<boolean> {
      return serial(async () => {
        const current = await settings();
        if (current.generation !== generation || !isActive(current)) return false;
        const existing = await openings(generation);
        const entry: RecordedOpening = { ...opening, openedAt: deps.now() };
        const entries = [...existing.entries.filter((item) => item.listingId !== opening.listingId || item.sourceTabId !== opening.sourceTabId), entry];
        await deps.session.set(OPENINGS_KEY, { ...existing, entries: entries.slice(-LIMITS.maxOpenings) });
        return true;
      });
    },

    /** Only an explicit opening from one of these tabs counts, never the latest search elsewhere. */
    async findOpening(listingId: ListingId, tabIds: readonly number[]): Promise<RecordedOpening | null> {
      const current = await settings();
      const { entries } = await openings(current.generation);
      const matches = entries.filter((entry) => entry.listingId === listingId && tabIds.includes(entry.sourceTabId));
      return matches.sort((a, b) => b.openedAt - a.openedAt)[0] ?? null;
    },
  };
}
