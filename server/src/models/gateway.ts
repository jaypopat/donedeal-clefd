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
