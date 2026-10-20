import type { AssessRequest } from '../../lib/contracts/assess';
import { AssessRequestSchema } from '../../lib/contracts/assess';
import type { DocumentNonce } from '../../lib/contracts/ids';
import { newContextId, newDocumentNonce } from '../../lib/contracts/ids';
import { redact } from '../../lib/privacy/redact';
import type { BackgroundMessage, CardSync } from '../../lib/messages';
import { createBackground } from '../../lib/extension/background';
import { createAssessClient } from '../../lib/extension/client';
import type { SendOutcome } from '../../lib/extension/scheduler';
import type { StorageArea } from '../../lib/extension/store';
import { createStore } from '../../lib/extension/store';
import { handle } from '../../server/src/http';
import { facts } from './listings';
import { clefResult } from './models';

export const NOW = 1_792_000_000_000;
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

export function memoryArea(): StorageArea & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key) {
      return structuredClone(data.get(key));
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
    async remove(key) {
      data.delete(key);
    },
  };
}

type Gate = { request: AssessRequest; release: () => void };

/** The real background core, client and Worker handler, with a scripted model and clock. */
export function harness(options: { modelsFail?: boolean } = {}) {
  const clock = { now: NOW };
  const local = memoryArea();
  const session = memoryArea();
  const store = createStore({ local, session, now: () => clock.now });
  const posted: Array<{ docId: string; message: BackgroundMessage }> = [];
  const requests: AssessRequest[] = [];
  const gates: Gate[] = [];
  let holdRequests = false;
  let inFlight = 0;
  let maxInFlight = 0;
  let workerUp = true;

  const ai = {
    async run(model: string) {
      if (options.modelsFail) throw new Error('model down');
      if (model === '@cf/cloudflare/clairic') return { model: 'clairic', answers: {}, truncated: false, usage: { input_tokens: 10 } };
      return clefResult({});
    },
  };
  const env = { TYREKICK_ENV: 'development', ALLOWED_EXTENSION_ORIGIN: ORIGIN, AI: ai };
  const client = createAssessClient({
    baseUrl: 'http://127.0.0.1:8787',
    fetch: async (url, init) => {
      if (!workerUp) throw new TypeError('connection refused');
      const headers = new Headers(init.headers);
      headers.set('origin', ORIGIN);
      return handle(new Request(url, { ...init, headers }), env, () => clock.now);
    },
  });

  async function send(request: AssessRequest, signal: AbortSignal): Promise<SendOutcome> {
    requests.push(AssessRequestSchema.parse(request));
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (holdRequests) await new Promise<void>((release) => gates.push({ request, release }));
      return await client(request, signal);
    } finally {
      inFlight -= 1;
    }
  }

  const background = createBackground({
    store,
    send,
    post: (docId, message) => posted.push({ docId, message }),
    now: () => clock.now,
  });

  return {
    clock,
    local,
    store,
    background,
    posted,
    requests,
    gates,
    get maxInFlight() {
      return maxInFlight;
    },
    get inFlight() {
      return inFlight;
    },
    hold(value: boolean) {
      holdRequests = value;
    },
    stopWorker() {
      workerUp = false;
    },
    messagesFor(docId: string) {
      return posted.filter((entry) => entry.docId === docId).map((entry) => entry.message);
    },
  };
}

export async function until(predicate: () => boolean, label = 'condition'): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`timed out waiting for ${label}`);
}

export function cards(count: number, start = 45000001): CardSync[] {
  return Array.from({ length: count }, (_, index) => ({
    facts: facts({ id: String(start + index), eur: 15000 + index * 100, mileage: { value: 90000 + index * 500, unit: 'km' } }),
    text: redact(`2018 Volkswagen Golf 1.6 TDI number ${index}`),
  }));
}

export function searchSync(documentNonce: DocumentNonce, cardList: CardSync[], contextId = newContextId()) {
  return {
    type: 'sync' as const,
    documentNonce,
    page: { kind: 'search' as const, contextId, observedAt: NOW, cards: cardList, visible: [] },
  };
}

export { newDocumentNonce };
