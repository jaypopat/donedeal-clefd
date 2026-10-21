/**
 * Posts one synthetic assessment to a running local Worker and checks the response contract.
 *
 *   bun scripts/smoke-worker.ts --extension-origin chrome-extension://<id> [--port 8787] [--require-models]
 *
 * Prints outcome codes, latency and evidence checks only, never listing text.
 */
import { parseArgs } from 'node:util';
import { AssessResponseSchema } from '../lib/contracts/assess';
import { contentFingerprint, contextFingerprint, targetFingerprint } from '../lib/contracts/fingerprint';
import { ListingFactsSchema } from '../lib/contracts/listing';
import { codepointSlice } from '../lib/contracts/text';
import { ASSESS_SCHEMA_VERSION, POLICY } from '../lib/contracts/versions';
import { redact } from '../lib/privacy/redact';

const { values } = parseArgs({
  options: {
    'extension-origin': { type: 'string', default: process.env.TYREKICK_EXTENSION_ORIGIN },
    port: { type: 'string', default: '8787' },
    'require-models': { type: 'boolean', default: false },
  },
});

function listing(id: number, eur: number, km: number) {
  return ListingFactsSchema.parse({
    listingId: String(id),
    url: `https://www.donedeal.ie/cars-for-sale/synthetic-golf/${id}`,
    price: { kind: 'cash', eur },
    year: 2018,
    mileage: { value: km, unit: 'km' },
    make: 'Volkswagen',
    model: 'Golf',
    fuel: 'diesel',
    transmission: 'manual',
    sellerType: 'dealer',
    engineLitres: 1.6,
    damageMentioned: false,
    variant: { kind: 'unmarked', source: 'title' },
    titleEvidence: { recovered: [], conflicts: [] },
    searchEvidence: [],
  });
}

const candidates = [15000, 17000, 17500, 18000, 18500, 19000, 19500].map((eur, index) => listing(44000001 + index, eur, 88000 + index * 1500));
const [target, second, third] = candidates;
if (!target || !second || !third) throw new Error('cohort too small');
const now = Date.now();
const texts = [
  { facts: target, text: redact('Please pay a €500 deposit before you are allowed to view the car.') },
  { facts: second, text: redact('No deposit needed. Please view the car before making any payment.') },
  { facts: third, text: redact('🚗 The mileage is 120,000 km. Viewing is available before payment.') },
];
const request = {
  schemaVersion: ASSESS_SCHEMA_VERSION,
  requestId: crypto.randomUUID(),
  policy: POLICY,
  price: { contextId: crypto.randomUUID(), observedAt: now, loadedCount: candidates.length, candidates, targetIds: [target.listingId] },
  warnings: { targets: texts.map((entry) => ({ ...entry, coverage: 'detail', observedAt: now })) },
};

const started = performance.now();
const response = await fetch(`http://127.0.0.1:${values.port}/v1/assess`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: values['extension-origin'] ?? '' },
  body: JSON.stringify(request),
});
const elapsedMs = Math.round(performance.now() - started);
if (!response.ok) {
  console.error(JSON.stringify({ status: response.status, body: await response.json().catch(() => null) }));
  process.exit(1);
}
const parsed = AssessResponseSchema.parse(await response.json());
const failures: string[] = [];
if (parsed.requestId !== request.requestId) failures.push('request id mismatch');
if (parsed.price?.contextFp !== (await contextFingerprint(candidates))) failures.push('context fingerprint mismatch');
const price = parsed.price?.results[0];
if (price?.targetFp !== (await targetFingerprint(target))) failures.push('target fingerprint mismatch');

const warnings = [];
for (const [index, result] of (parsed.warnings?.results ?? []).entries()) {
  const submitted = texts[index];
  if (!submitted) continue;
  const expectedFp = await contentFingerprint({ facts: submitted.facts, text: submitted.text, coverage: 'detail' });
  if (result.contentFp !== expectedFp) failures.push(`content fingerprint mismatch ${index}`);
  const outcome = result.result;
  if (outcome.kind === 'unavailable') {
    warnings.push({ target: index, outcome: outcome.error });
    if (values['require-models']) failures.push(`warning ${index} unavailable: ${outcome.error}`);
    continue;
  }
  const spansValid = outcome.findings.every((finding) =>
    finding.evidence.every((evidence) => evidence.kind !== 'text' || codepointSlice(submitted.text, evidence.start, evidence.end) === evidence.excerpt),
  );
  if (!spansValid) failures.push(`warning ${index} evidence does not match submitted text`);
  warnings.push({ target: index, outcome: 'checked', reasons: outcome.findings.map((finding) => finding.reason), spansValid });
}

console.log(JSON.stringify({ status: response.status, elapsedMs, price: price?.result.kind === 'ready' ? price.result.label : price?.result, warnings, failures }, null, 2));
process.exit(failures.length > 0 ? 1 : 0);
