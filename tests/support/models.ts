import type { ModelGateway, ModelName } from '../../server/src/models/gateway';
import { ModelFailure } from '../../server/src/models/gateway';
import { CLAIM_FIELDS } from '../../server/src/models/clairic';

export type ModelCall = { model: ModelName; body: Record<string, unknown> };

type Responder = (body: Record<string, unknown>) => unknown;

export function fakeGateway(responders: Partial<Record<ModelName, Responder>>): { gateway: ModelGateway; calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  const gateway: ModelGateway = async ({ model, body }) => {
    calls.push({ model, body });
    const responder = responders[model];
    if (!responder) throw new ModelFailure('model_error');
    return responder(body);
  };
  return { gateway, calls };
}

/** Codepoint span of the first occurrence of `phrase`, as Clairic reports it. */
export function spanOf(text: string, phrase: string): [number, number] {
  const unitIndex = text.indexOf(phrase);
  if (unitIndex < 0) throw new Error(`phrase not in text: ${phrase}`);
  const start = Array.from(text.slice(0, unitIndex)).length;
  return [start, start + Array.from(phrase).length];
}

export function simulatedNullClaim(): { type: 'text'; value: null } {
  return { type: 'text', value: null };
}

/**
 * Recorded extraction fixtures requested fewer fields than adapter does.
 * Wrap their answers with explicitly simulated null fields for unrequested known fields.
 */
export function withSimulatedNullClaims<T extends Record<string, unknown>>(resultOrAnswers: T): T {
  if ('answers' in resultOrAnswers && typeof resultOrAnswers.answers === 'object' && resultOrAnswers.answers !== null) {
    const raw = resultOrAnswers.answers as Record<string, unknown>;
    const answers = { ...raw };
    for (const name of Object.keys(CLAIM_FIELDS)) {
      if (!Object.hasOwn(answers, name)) {
        answers[name] = simulatedNullClaim();
      }
    }
    return { ...resultOrAnswers, answers };
  }
  const answers = { ...(resultOrAnswers as Record<string, unknown>) };
  for (const name of Object.keys(CLAIM_FIELDS)) {
    if (!Object.hasOwn(answers, name)) {
      answers[name] = simulatedNullClaim();
    }
  }
  return answers as T;
}

export function clairicAnswers(answers: Record<string, unknown>, truncated = false): unknown {
  return { model: 'clairic', answers, truncated, usage: { input_tokens: 300, output_tokens: 0 } };
}

export function clairicResult(text: string, claims: Record<string, string>): unknown {
  const answers: Record<string, unknown> = {};
  for (const name of Object.keys(CLAIM_FIELDS)) {
    const phrase = claims[name];
    if (typeof phrase === 'string') {
      answers[name] = {
        type: 'text',
        value: phrase,
        guess: phrase,
        span: spanOf(text, phrase),
        confidence: 0.9,
        p_null: 0.01,
      };
    } else {
      answers[name] = simulatedNullClaim();
    }
  }
  return clairicAnswers(answers);
}

export function clefResult(answers: Record<string, number>): unknown {
  return {
    model: 'clef',
    answers: Object.fromEntries(Object.entries(answers).map(([name, noul]) => [name, { type: 'noul', noul }])),
    usage: { input_tokens: 170, output_tokens: 0 },
  };
}

export function askedQuestions(body: Record<string, unknown>): string[] {
  const questions = body.questions;
  return typeof questions === 'object' && questions !== null ? Object.keys(questions) : [];
}
