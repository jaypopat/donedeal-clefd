import type { ModelGateway, ModelName } from '../../server/src/models/gateway';
import { ModelFailure } from '../../server/src/models/gateway';

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

export function clairicAnswers(answers: Record<string, unknown>, truncated = false): unknown {
  return { model: 'clairic', answers, truncated, usage: { input_tokens: 300, output_tokens: 0 } };
}

export function clairicResult(text: string, claims: Record<string, string>): unknown {
  const answers = Object.fromEntries(
    Object.entries(claims).map(([name, phrase]) => [
      name,
      { type: 'text', value: phrase, guess: phrase, span: spanOf(text, phrase), confidence: 0.9, p_null: 0.01 },
    ]),
  );
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
