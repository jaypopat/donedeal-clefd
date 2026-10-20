import { z } from 'zod';
import type { RedactedText } from '../../../lib/privacy/redact';
import type { Meter, ModelGateway } from './gateway';
import { ModelFailure } from './gateway';

/** Fixed yes/no questions. The answer probability stays internal to the evidence policy. */
export const QUESTIONS = {
  payment_before_viewing: 'Does the text explicitly demand a deposit or any payment before the buyer can see the car in person?',
  shipping_only: 'Does the text say the car can only be shipped or delivered, with no chance to view it in person first?',
  business_seller: 'Does the text indicate that the seller is a business or motor trader rather than a private individual?',
  service_history_conflict: 'Does the text contradict itself about whether the car has a full service history?',
} as const;

export type QuestionName = keyof typeof QUESTIONS;

/** Probability of yes per asked question. */
export type Judgements = Partial<Record<QuestionName, number>>;

const ResultSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  usage: z.object({ input_tokens: z.int().nonnegative() }),
});

const NoulSchema = z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) });

export async function judge(input: {
  gateway: ModelGateway;
  text: RedactedText;
  questions: readonly QuestionName[];
  signal: AbortSignal;
  meter: Meter;
}): Promise<Judgements> {
  if (input.questions.length === 0) return {};
  const questions = Object.fromEntries(
    input.questions.map((name) => [name, { type: 'noul', instructions: QUESTIONS[name] }]),
  );
  input.meter.modelCalls += 1;
  const raw = await input.gateway({ model: 'clef', body: { state: input.text, questions }, signal: input.signal });
  const result = ResultSchema.safeParse(raw);
  if (!result.success) throw new ModelFailure('model_invalid_output');
  input.meter.inputTokens += result.data.usage.input_tokens;

  const judgements: Judgements = {};
  for (const name of input.questions) {
    const answer = NoulSchema.safeParse(result.data.answers[name]);
    if (!answer.success) throw new ModelFailure('model_invalid_output');
    judgements[name] = answer.data.noul;
  }
  return judgements;
}
