import { z } from 'zod';
import type { BranchError } from '../../../lib/contracts/assess';

export type ModelName = 'clairic' | 'clef';

export type Meter = { modelCalls: number; inputTokens: number };

/** Runs a Workers AI text model and returns its direct result object, unparsed. */
export type ModelGateway = (input: { model: ModelName; body: Record<string, unknown>; signal: AbortSignal }) => Promise<unknown>;

export class ModelFailure extends Error {
  constructor(readonly code: Extract<BranchError, 'model_error' | 'model_invalid_output' | 'timeout'>) {
    super(code);
  }
}

/** The subset of the Workers AI binding this Worker uses. */
export type AiBinding = { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ModelFailure('timeout'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ModelFailure('timeout'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function bindingGateway(ai: AiBinding): ModelGateway {
  return async ({ model, body, signal }) => {
    try {
      return await abortable(ai.run(`@cf/cloudflare/${model}`, { model, ...body }), signal);
    } catch (error) {
      if (error instanceof ModelFailure) throw error;
      throw new ModelFailure('model_error');
    }
  };
}

const RestEnvelopeSchema = z.object({ success: z.literal(true), result: z.unknown() });

/** Local-development gateway using a Cloudflare API token held only in the Worker's environment. */
export function restGateway(config: { accountId: string; token: string; fetch?: typeof fetch }): ModelGateway {
  const send = config.fetch ?? fetch;
  return async ({ model, body, signal }) => {
    let response: Response;
    try {
      response = await send(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/run/@cf/cloudflare/${model}`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, ...body }),
          signal,
        },
      );
    } catch {
      throw new ModelFailure(signal.aborted ? 'timeout' : 'model_error');
    }
    if (!response.ok) throw new ModelFailure('model_error');
    const envelope = RestEnvelopeSchema.safeParse(await response.json().catch(() => null));
    if (!envelope.success) throw new ModelFailure('model_invalid_output');
    return envelope.data.result;
  };
}
