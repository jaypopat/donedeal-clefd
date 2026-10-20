import { z } from 'zod';
import type { ApiErrorCode, AssessResponse } from '../../lib/contracts/assess';
import { AssessRequestSchema } from '../../lib/contracts/assess';
import { ASSESS_SCHEMA_VERSION, LIMITS, POLICY } from '../../lib/contracts/versions';
import { assess } from './assess';
import type { AiBinding, Meter, ModelGateway } from './models/gateway';
import { bindingGateway } from './models/gateway';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const AiBindingSchema = z.custom<AiBinding>(
  (value) => typeof value === 'object' && value !== null && typeof Reflect.get(value, 'run') === 'function',
);

/**
 * Local development is the only configuration that serves requests. A hosted
 * Worker has no TYREKICK_ENV and fails closed until private access exists.
 */
const DevConfigSchema = z.object({
  TYREKICK_ENV: z.literal('development'),
  ALLOWED_EXTENSION_ORIGIN: z.string().regex(/^chrome-extension:\/\/[a-p]{32}$/),
  AI: AiBindingSchema.optional(),
});

const VersionSchema = z.object({
  schemaVersion: z.string(),
  policy: z.object({ pricing: z.string(), warnings: z.string(), privacy: z.string() }),
});

const STATUS: Record<ApiErrorCode, number> = {
  access_not_configured: 403,
  forbidden_origin: 403,
  not_found: 404,
  method_not_allowed: 405,
  unsupported_media_type: 415,
  payload_too_large: 413,
  invalid_json: 400,
  invalid_request: 400,
  version_mismatch: 409,
  internal: 500,
};

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function errorResponse(error: ApiErrorCode, issues?: string[]): Response {
  return new Response(JSON.stringify(issues ? { error, issues } : { error }), { status: STATUS[error], headers: HEADERS });
}

type Body = { kind: 'text'; text: string } | { kind: 'too_large' } | { kind: 'undecodable' };

/** Counts bytes as they arrive so an undeclared or understated length cannot exceed the limit. */
async function readBoundedBody(request: Request, maxBytes: number): Promise<Body> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { kind: 'too_large' };
  if (!request.body) return { kind: 'text', text: '' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { kind: 'too_large' };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { kind: 'undecodable' };
  }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function logMetrics(fields: Record<string, string | number>): void {
  console.log(JSON.stringify({ event: 'tyrekick.assess', ...fields }));
}

function outcomeCounts(response: AssessResponse): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { result } of response.price?.results ?? []) {
    const key = `price_${result.kind === 'insufficient' ? result.reason.code : result.kind}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  for (const { result } of response.warnings?.results ?? []) {
    const key = `warning_${result.kind === 'unavailable' ? result.error : result.findings.length > 0 ? 'findings' : 'clear'}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export async function handle(request: Request, env: unknown, now: () => number = Date.now): Promise<Response> {
  const config = DevConfigSchema.safeParse(env);
  if (!config.success) return errorResponse('access_not_configured');
  const url = new URL(request.url);
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return errorResponse('access_not_configured');
  if (request.headers.get('origin') !== config.data.ALLOWED_EXTENSION_ORIGIN) return errorResponse('forbidden_origin');
  if (url.pathname !== '/v1/assess') return errorResponse('not_found');
  if (request.method !== 'POST') return errorResponse('method_not_allowed');
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/json(\s*;\s*charset=utf-8)?$/i.test(contentType.trim())) return errorResponse('unsupported_media_type');

  const started = now();
  const body = await readBoundedBody(request, LIMITS.maxBodyBytes);
  if (body.kind === 'too_large') return errorResponse('payload_too_large');
  if (body.kind === 'undecodable') return errorResponse('invalid_json');
  const json = parseJson(body.text);
  if (!json.ok) return errorResponse('invalid_json');

  const version = VersionSchema.safeParse(json.value);
  if (
    !version.success ||
    version.data.schemaVersion !== ASSESS_SCHEMA_VERSION ||
    version.data.policy.pricing !== POLICY.pricing ||
    version.data.policy.warnings !== POLICY.warnings ||
    version.data.policy.privacy !== POLICY.privacy
  ) {
    return errorResponse('version_mismatch');
  }
  const parsed = AssessRequestSchema.safeParse(json.value);
  if (!parsed.success) {
    return errorResponse(
      'invalid_request',
      parsed.error.issues.slice(0, 20).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }

  const meter: Meter = { modelCalls: 0, inputTokens: 0 };
  const gateway: ModelGateway | null = config.data.AI ? bindingGateway(config.data.AI) : null;
  try {
    const response = await assess(parsed.data, { gateway, now, meter });
    logMetrics({
      status: 200,
      ms: now() - started,
      priceTargets: response.price?.results.length ?? 0,
      warningTargets: response.warnings?.results.length ?? 0,
      ...meter,
      ...outcomeCounts(response),
    });
    return new Response(JSON.stringify(response), { status: 200, headers: HEADERS });
  } catch {
    logMetrics({ status: 500, ms: now() - started, ...meter });
    return errorResponse('internal');
  }
}
