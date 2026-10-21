import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { AssessResponseSchema, type ReasonCode, type WarningTarget, type WarningTargetResult } from '../lib/contracts/assess';
import { contentFingerprint } from '../lib/contracts/fingerprint';
import { codepointSlice } from '../lib/contracts/text';
import { ASSESS_SCHEMA_VERSION, POLICY } from '../lib/contracts/versions';
import { redact } from '../lib/privacy/redact';
import { facts } from '../tests/support/listings';

const { values } = parseArgs({ options: { port: { type: 'string', default: '8791' }, 'extension-origin': { type: 'string' }, case: { type: 'string' } } });
assert.match(values.port, /^\d{2,5}$/);
assert.match(values['extension-origin'] ?? '', /^chrome-extension:\/\/[a-p]{32}$/);

const examples: Array<{ name: string; text: string; coverage: WarningTarget['coverage']; expected: ReasonCode[] }> = [
  { name: 'no viewing without deposit', text: 'No viewing without a deposit.', coverage: 'detail', expected: ['payment_before_viewing'] },
  { name: 'cannot view without deposit', text: 'Cannot view without deposit.', coverage: 'detail', expected: ['payment_before_viewing'] },
  { name: 'viewing not required', text: 'Viewing not required, send €500 deposit to secure it.', coverage: 'detail', expected: ['payment_before_viewing'] },
  { name: 'no deposit needed', text: 'No deposit needed before viewing.', coverage: 'detail', expected: [] },
  { name: 'service distance', text: 'Timing belt and service done at 60,000km.', coverage: 'detail', expected: [] },
  { name: 'service interval before current odometer', text: 'Serviced 5,000 km ago, now on 90,000 km.', coverage: 'detail', expected: [] },
  { name: 'belt distance before current odometer', text: 'Timing belt changed 60,000km, mileage 90,000km.', coverage: 'detail', expected: [] },
  { name: 'odometer miles', text: 'Only 40k mls on the clock.', coverage: 'detail', expected: ['mileage_mismatch'] },
  { name: 'limited detail coverage', text: 'Ordinary listing text. '.repeat(250), coverage: 'detail_partial', expected: [] },
];
const cases = values.case ? examples.filter((entry) => entry.name === values.case) : examples;
assert.ok(cases.length > 0, 'No matching cases');
const now = Date.now();
const targets: WarningTarget[] = cases.map((entry, index) => ({
  facts: facts({ id: String(56000001 + index) }), text: redact(entry.text), coverage: entry.coverage, observedAt: now,
}));
const requestId = crypto.randomUUID();
const response = await fetch(`http://127.0.0.1:${values.port}/v1/assess`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: values['extension-origin'] ?? '' },
  body: JSON.stringify({ schemaVersion: ASSESS_SCHEMA_VERSION, policy: POLICY, requestId, price: null, warnings: { targets } }),
});
assert.equal(response.status, 200);
const result = AssessResponseSchema.parse(await response.json());
assert.equal(result.requestId, requestId);
assert.equal(result.warnings?.results.length, targets.length);
const checks = [];
const failures: Array<{ name: string; error: string }> = [];
for (const [index, entry] of cases.entries()) {
  const target = targets[index];
  assert.ok(target);
  const checked: WarningTargetResult | undefined = result.warnings?.results.find((item) => item.listingId === target.facts.listingId);
  assert.ok(checked, entry.name);
  assert.equal(checked.coverage, target.coverage, entry.name);
  assert.equal(checked.contentFp, await contentFingerprint(target), entry.name);
  if (checked.result.kind !== 'checked') {
    failures.push({ name: entry.name, error: checked.result.error });
    continue;
  }
  for (const finding of checked.result.findings) {
    for (const evidence of finding.evidence) {
      if (evidence.kind === 'text') assert.equal(codepointSlice(target.text, evidence.start, evidence.end), evidence.excerpt, entry.name);
    }
  }
  const reasons = checked.result.findings.map((finding) => finding.reason).sort();
  if (JSON.stringify(reasons) !== JSON.stringify([...entry.expected].sort())) failures.push({ name: entry.name, error: `unexpected findings: ${reasons.join(', ') || 'none'}` });
  checks.push({ name: entry.name, coverage: checked.coverage, reasons });
}
console.log(JSON.stringify({ provider: 'real Workers AI', checks, failures }, null, 2));
assert.deepEqual(failures, [], 'Some real-model checks were unavailable');
