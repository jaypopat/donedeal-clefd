import type { WarningResult, WarningTarget } from '../../../lib/contracts/assess';
import type { Meter, ModelGateway } from '../models/gateway';
import { ModelFailure } from '../models/gateway';
import { extractClaims } from '../models/clairic';
import { judge } from '../models/clef';
import { findingsFrom, questionsFor } from './policy';

const TARGET_TIMEOUT_MS = 20_000;

const CARD_CUES = [
  /\b\d[\d,.]*\s*(k|km|kms|kilomet\w*|mi|miles?)\b|\bmileage\b|\bodometer\b/i,
  /\b(deposit|payment|pay|paid|transfer|western union|revolut|money)\b/i,
  /\b(ship|shipping|shipped|courier|abroad|overseas)\b/i,
  /\b(service|serviced|history)\b/i,
];
const PRIVATE_TRADE_CUE = /\b(finance|trade[- ]?ins?|warranty|dealer|stock|showroom|garage)\b/i;

/** Card titles rarely say anything checkable, so they skip model work unless a cue appears. */
function worthModelCheck(target: WarningTarget): boolean {
  if (target.text.trim() === '') return false;
  if (target.coverage === 'detail') return true;
  if (CARD_CUES.some((cue) => cue.test(target.text))) return true;
  return target.facts.sellerType === 'private' && PRIVATE_TRADE_CUE.test(target.text);
}

export async function assessWarning(input: {
  target: WarningTarget;
  gateway: ModelGateway;
  meter: Meter;
  signal?: AbortSignal;
}): Promise<WarningResult> {
  const { target, gateway, meter } = input;
  if (!worthModelCheck(target)) return { kind: 'checked', findings: [] };
  const signal = AbortSignal.any([AbortSignal.timeout(TARGET_TIMEOUT_MS), ...(input.signal ? [input.signal] : [])]);
  try {
    const extraction = await extractClaims({ gateway, text: target.text, signal, meter });
    const questions = questionsFor({ facts: target.facts, claims: extraction.claims });
    const judgements = await judge({ gateway, text: target.text, questions, signal, meter });
    return { kind: 'checked', findings: findingsFrom({ facts: target.facts, claims: extraction.claims, judgements }) };
  } catch (error) {
    if (error instanceof ModelFailure) return { kind: 'unavailable', error: error.code };
    return { kind: 'unavailable', error: 'internal' };
  }
}
