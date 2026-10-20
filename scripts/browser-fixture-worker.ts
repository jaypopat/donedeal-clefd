import { z } from 'zod';
import { handle } from '../server/src/http';
import { AssessRequestSchema } from '../lib/contracts/assess';
import { clairicResult, clefResult, askedQuestions } from '../tests/support/models';

const config = z.object({
  port: z.coerce.number().int().min(1024).max(65535),
  origin: z.string().regex(/^chrome-extension:\/\/[a-p]{32}$/),
}).parse({ port: process.env.TYREKICK_VERIFY_PORT, origin: process.env.TYREKICK_VERIFY_ORIGIN });
let requests = 0;
let delayMs = 0;
let fail = false;
let warningTargets = 0;
let lastWarnings: Array<{ coverage: string; hasPayment: boolean }> = [];
const modelInputs: Array<{ model: string; hasPayment: boolean }> = [];
const control = z.object({ delayMs: z.number().int().min(0).max(10000), fail: z.boolean() });
const ai = {
  async run(model: string, body: Record<string, unknown>) {
    const text = typeof body.state === 'string' ? body.state : '';
    const phrase = 'Pay a €500 deposit before viewing.';
    modelInputs.push({ model, hasPayment: text.includes(phrase) });
    if (model.endsWith('/clairic')) return clairicResult(text, text.includes(phrase) ? { payment_statement: phrase } : {});
    return clefResult(Object.fromEntries(askedQuestions(body).map((name) => [name, text.includes(phrase) ? .99 : .01])));
  },
};

Bun.serve({
  hostname: '127.0.0.1', port: config.port,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/stats') return Response.json({ requests, warningTargets, lastWarnings, modelInputs });
    if (path === '/control' && request.method === 'POST') {
      const next = control.parse(await request.json());
      delayMs = next.delayMs;
      fail = next.fail;
      return Response.json({ ok: true });
    }
    requests++;
    const submitted: unknown = await request.clone().json();
    const branch = z.object({ warnings: z.object({ targets: z.array(z.unknown()) }).nullable() }).safeParse(submitted);
    warningTargets += branch.success ? branch.data.warnings?.targets.length ?? 0 : 0;
    const parsed = AssessRequestSchema.safeParse(submitted);
    if (parsed.success && parsed.data.warnings) lastWarnings = parsed.data.warnings.targets.map((target) => ({
      coverage: target.coverage, hasPayment: target.text.includes('Pay a €500 deposit before viewing.'),
    }));
    const wait = delayMs;
    const failed = fail;
    if (wait) await Bun.sleep(wait);
    if (failed) return new Response(null, { status: 503 });
    return handle(request, { TYREKICK_ENV: 'development', ALLOWED_EXTENSION_ORIGIN: config.origin, AI: ai });
  },
});
console.log('Fixture Worker ready');
