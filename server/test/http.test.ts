import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { AssessResponseSchema } from '../../lib/contracts/assess';
import { contentFingerprint, contextFingerprint, targetFingerprint } from '../../lib/contracts/fingerprint';
import { ASSESS_SCHEMA_VERSION, LIMITS, POLICY } from '../../lib/contracts/versions';
import { redact } from '../../lib/privacy/redact';
import { facts } from '../../tests/support/listings';
import { clairicResult, clefResult } from '../../tests/support/models';
import { handle } from '../src/http';

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const URL_LOCAL = 'http://127.0.0.1:8787/v1/assess';
const NOW = 1_792_000_000_000;

const cohort = [17000, 17500, 18000, 18500, 19000, 19500].map((eur, index) =>
  facts({ id: String(43000001 + index), eur, mileage: { value: 90000 + index * 1000, unit: 'km' } }),
);
const target = facts({ id: '43000100', eur: 15000 });
const scamText = redact('Lovely car. Please pay a €500 deposit before you are allowed to view the car. SECRETPHRASE');
const otherText = redact('The mileage is 120,000 km. SECRETPHRASE');

function body(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: ASSESS_SCHEMA_VERSION,
    requestId: crypto.randomUUID(),
    policy: POLICY,
    price: { contextId: crypto.randomUUID(), observedAt: NOW, loadedCount: 7, candidates: [target, ...cohort], targetIds: [target.listingId] },
    warnings: {
      targets: [
        { facts: target, coverage: 'detail', text: scamText, observedAt: NOW },
        { facts: cohort[0], coverage: 'detail', text: otherText, observedAt: NOW },
      ],
    },
    ...overrides,
  };
}

const ai = {
  async run(model: string, inputs: Record<string, unknown>) {
    const state = String(inputs.state);
    if (model === '@cf/cloudflare/clairic') {
      if (state.includes('mileage')) throw new Error('provider down');
      return clairicResult(state, { payment_statement: 'Please pay a €500 deposit before you are allowed to view the car' });
    }
    return clefResult({ payment_before_viewing: 0.92 });
  },
};

const env = { TYREKICK_ENV: 'development', ALLOWED_EXTENSION_ORIGIN: ORIGIN, AI: ai };

function post(payload: unknown, init: { url?: string; origin?: string | null; contentType?: string } = {}) {
  const headers = new Headers({ 'content-type': init.contentType ?? 'application/json' });
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
  return new Request(init.url ?? URL_LOCAL, { method: 'POST', headers, body: JSON.stringify(payload) });
}

async function errorOf(response: Response) {
  return { status: response.status, body: await response.json() };
}

let logs: string[] = [];
let spy: ReturnType<typeof spyOn> | null = null;
beforeEach(() => {
  logs = [];
  spy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
});
afterEach(() => spy?.mockRestore());

describe('access', () => {
  test('fails closed without explicit development configuration', async () => {
    expect(await errorOf(await handle(post(body()), {}))).toEqual({ status: 403, body: { error: 'access_not_configured' } });
    const production = { ...env, TYREKICK_ENV: 'production' };
    expect((await handle(post(body()), production)).status).toBe(403);
  });

  test('fails closed for hosted requests even when development is configured', async () => {
    const hosted = post(body(), { url: 'https://tyrekick.example.workers.dev/v1/assess' });
    expect(await errorOf(await handle(hosted, env))).toEqual({ status: 403, body: { error: 'access_not_configured' } });
  });

  test('requires the configured extension origin', async () => {
    expect(await errorOf(await handle(post(body(), { origin: 'https://www.donedeal.ie' }), env))).toEqual({
      status: 403,
      body: { error: 'forbidden_origin' },
    });
    expect((await handle(post(body(), { origin: null }), env)).status).toBe(403);
  });

  test('sends no CORS headers', async () => {
    const response = await handle(post(body()), env, () => NOW);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('request validation', () => {
  test('requires JSON content', async () => {
    expect((await handle(post(body(), { contentType: 'text/plain' }), env)).status).toBe(415);
  });

  test('stops reading a streamed body once it passes the size limit', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024).fill(32);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
        if (pulled > 100) controller.close();
      },
    });
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    };
    const request = new Request(URL_LOCAL, init);
    expect((await handle(request, env)).status).toBe(413);
    expect(pulled * chunk.byteLength).toBeLessThan(LIMITS.maxBodyBytes + 3 * chunk.byteLength);
  });

  test('rejects malformed JSON and version mismatches', async () => {
    const malformed = new Request(URL_LOCAL, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{' });
    expect((await handle(malformed, env)).status).toBe(400);
    expect(await errorOf(await handle(post(body({ policy: { ...POLICY, pricing: 'pricing.old' } })), env))).toEqual({
      status: 409,
      body: { error: 'version_mismatch' },
    });
  });

  test('reports invalid fields by path without echoing submitted values', async () => {
    const bad = body({
      warnings: { targets: [{ facts: target, coverage: 'detail', text: 'Call 087 123 4567 SECRETPHRASE', observedAt: NOW }] },
    });
    const response = await errorOf(await handle(post(bad), env));
    expect(response.status).toBe(400);
    expect(response.body.issues).toEqual(['warnings.targets.0.text: text is not redacted']);
    expect(JSON.stringify(response.body)).not.toContain('SECRETPHRASE');
  });
});

describe('assessment', () => {
  test('returns independent price and per-target warning results with recomputed fingerprints', async () => {
    const payload = body();
    const response = await handle(post(payload), env, () => NOW);
    expect(response.status).toBe(200);
    const parsed = AssessResponseSchema.parse(await response.json());
    expect(parsed.requestId).toBe(payload.requestId);
    expect(parsed.price?.contextFp).toBe(await contextFingerprint([target, ...cohort]));
    expect(parsed.price?.results).toEqual([
      {
        listingId: target.listingId,
        targetFp: await targetFingerprint(target),
        result: expect.objectContaining({ kind: 'ready', label: 'great', matchCount: 6 }),
      },
    ]);
    const [scam, failed] = parsed.warnings?.results ?? [];
    expect(scam?.contentFp).toBe(await contentFingerprint({ facts: target, text: scamText, coverage: 'detail' }));
    expect(scam?.result).toMatchObject({ kind: 'checked', findings: [{ reason: 'payment_before_viewing' }] });
    expect(failed?.result).toEqual({ kind: 'unavailable', error: 'model_error' });
  });

  test('keeps the price branch working when no model binding is available', async () => {
    const response = await handle(post(body()), { TYREKICK_ENV: 'development', ALLOWED_EXTENSION_ORIGIN: ORIGIN }, () => NOW);
    const parsed = AssessResponseSchema.parse(await response.json());
    expect(parsed.price?.results[0]?.result.kind).toBe('ready');
    expect(parsed.warnings?.results.map((result) => result.result)).toEqual([
      { kind: 'unavailable', error: 'service_unavailable' },
      { kind: 'unavailable', error: 'service_unavailable' },
    ]);
  });

  test('logs counts and codes, never listing text', async () => {
    await handle(post(body()), env, () => NOW);
    expect(logs).toHaveLength(1);
    expect(logs.join('\n')).not.toContain('SECRETPHRASE');
    expect(logs.join('\n')).not.toContain('donedeal.ie');
    expect(JSON.parse(logs[0] ?? '{}')).toMatchObject({ event: 'tyrekick.assess', status: 200, modelCalls: 3 });
  });
});
