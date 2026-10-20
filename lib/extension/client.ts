import type { AssessRequest, AssessResponse, WarningTargetResult } from '../contracts/assess';
import { AssessResponseSchema } from '../contracts/assess';
import { contentFingerprint, contextFingerprint, targetFingerprint } from '../contracts/fingerprint';
import { codepointSlice } from '../contracts/text';
import type { SendOutcome } from './scheduler';

const REQUEST_TIMEOUT_MS = 45_000;

function evidenceMatches(result: WarningTargetResult, text: string): boolean {
  if (result.result.kind !== 'checked') return true;
  return result.result.findings.every((finding) =>
    finding.evidence.every(
      (evidence) => evidence.kind !== 'text' || codepointSlice(text, evidence.start, evidence.end) === evidence.excerpt,
    ),
  );
}

/**
 * Keeps only results whose identity and evidence match what was sent. A dropped
 * result surfaces as unavailable for that target alone.
 */
async function verified(request: AssessRequest, response: AssessResponse): Promise<AssessResponse | null> {
  if (response.requestId !== request.requestId) return null;
  let price: AssessResponse['price'] = null;
  if (request.price && response.price && response.price.contextId === request.price.contextId) {
    const work = request.price;
    if (response.price.contextFp === (await contextFingerprint(work.candidates))) {
      const expected = new Map(
        await Promise.all(
          work.candidates
            .filter((candidate) => work.targetIds.includes(candidate.listingId))
            .map(async (candidate) => [candidate.listingId, await targetFingerprint(candidate)] as const),
        ),
      );
      price = { ...response.price, results: response.price.results.filter((entry) => expected.get(entry.listingId) === entry.targetFp) };
    }
  }
  let warnings: AssessResponse['warnings'] = null;
  if (request.warnings && response.warnings) {
    const targets = new Map(request.warnings.targets.map((target) => [target.facts.listingId, target]));
    const kept: WarningTargetResult[] = [];
    for (const entry of response.warnings.results) {
      const target = targets.get(entry.listingId);
      if (!target || entry.coverage !== target.coverage) continue;
      if (entry.contentFp !== (await contentFingerprint(target)) || !evidenceMatches(entry, target.text)) continue;
      kept.push(entry);
    }
    warnings = { results: kept };
  }
  return { ...response, price, warnings };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function createAssessClient(config: { baseUrl: string; fetch?: Fetch }) {
  const send: Fetch = config.fetch ?? ((url, init) => fetch(url, init));
  return async function assess(request: AssessRequest, signal: AbortSignal): Promise<SendOutcome> {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    let response: Response;
    try {
      response = await send(`${config.baseUrl}/v1/assess`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: bounded,
      });
    } catch {
      return { kind: 'failed', error: bounded.aborted ? 'timeout' : 'service_unavailable' };
    }
    if (!response.ok) return { kind: 'failed', error: 'service_unavailable' };
    const parsed = AssessResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) return { kind: 'failed', error: 'invalid_response' };
    const checked = await verified(request, parsed.data);
    return checked ? { kind: 'response', response: checked } : { kind: 'failed', error: 'invalid_response' };
  };
}
