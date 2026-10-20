import { z } from 'zod';
import { codepointLength, codepointSlice } from '../../../lib/contracts/text';
import { LIMITS } from '../../../lib/contracts/versions';
import type { RedactedText } from '../../../lib/privacy/redact';
import type { Meter, ModelGateway } from './gateway';
import { ModelFailure } from './gateway';

export const CLAIM_FIELDS = {
  mileage_statement: 'Exact phrase stating the odometer mileage with its unit, such as "68,000 km" or "40k miles"',
  year_statement: 'Exact phrase stating the year the car was made or first registered',
  fuel_statement: 'Exact phrase stating the fuel or engine type, such as diesel, petrol, TDI or hybrid',
  transmission_statement: 'Exact phrase stating whether the gearbox is manual or automatic',
  payment_statement: 'Exact sentence about deposits, payment or money transfer, including any condition about viewing',
  shipping_statement: 'Exact sentence saying the car is abroad, or can only be shipped or delivered rather than viewed',
  service_full_statement: 'Exact phrase claiming a full or complete service history',
  service_gap_statement: 'Exact phrase saying the service history is partial, incomplete, missing or unavailable',
  trade_statement: 'Exact phrase suggesting a business sale, such as finance offered, trade-ins, warranty, or stock',
} as const;

export type ClaimName = keyof typeof CLAIM_FIELDS;

/** A text claim whose span was verified against the submitted text in codepoints. */
export type Claim = { start: number; end: number; excerpt: string };

export type Extraction = { claims: Partial<Record<ClaimName, Claim>>; rejectedClaims: number };

const AnswerSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  span: z.tuple([z.int(), z.int()]).nullish(),
});

const ResultSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  truncated: z.boolean(),
  usage: z.object({ input_tokens: z.int().nonnegative() }),
});

function isClaimName(name: string): name is ClaimName {
  return Object.hasOwn(CLAIM_FIELDS, name);
}

/** Only `value` is authoritative. A null value can still carry a guess and span; those are ignored. */
function verifiedClaim(text: RedactedText, raw: unknown): Claim | 'absent' | 'rejected' {
  const answer = AnswerSchema.safeParse(raw);
  if (!answer.success) return 'rejected';
  const { value, span } = answer.data;
  if (value === null) return 'absent';
  if (typeof value !== 'string' || !span) return 'rejected';
  const [start, end] = span;
  if (start < 0 || end <= start || end > codepointLength(text)) return 'rejected';
  if (end - start > LIMITS.maxExcerptCodepoints) return 'rejected';
  const excerpt = codepointSlice(text, start, end);
  return excerpt === value ? { start, end, excerpt } : 'rejected';
}

export async function extractClaims(input: {
  gateway: ModelGateway;
  text: RedactedText;
  signal: AbortSignal;
  meter: Meter;
}): Promise<Extraction> {
  const fields = Object.fromEntries(
    Object.entries(CLAIM_FIELDS).map(([name, instructions]) => [name, { type: 'text', instructions }]),
  );
  input.meter.modelCalls += 1;
  const raw = await input.gateway({ model: 'clairic', body: { state: input.text, fields }, signal: input.signal });
  const result = ResultSchema.safeParse(raw);
  if (!result.success || result.data.truncated) throw new ModelFailure('model_invalid_output');
  input.meter.inputTokens += result.data.usage.input_tokens;

  const claims: Partial<Record<ClaimName, Claim>> = {};
  let rejectedClaims = 0;
  for (const name of Object.keys(CLAIM_FIELDS) as ClaimName[]) {
    if (!Object.hasOwn(result.data.answers, name) || result.data.answers[name] === undefined) {
      throw new ModelFailure('model_invalid_output');
    }
    const claim = verifiedClaim(input.text, result.data.answers[name]);
    if (claim === 'rejected') rejectedClaims += 1;
    else if (claim !== 'absent') claims[name] = claim;
  }
  return { claims, rejectedClaims };
}
