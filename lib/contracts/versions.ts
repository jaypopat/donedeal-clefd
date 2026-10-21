export const ASSESS_SCHEMA_VERSION = 'tyrekick.assess.v2';
export const PRICING_POLICY_VERSION = 'pricing.2026-10-20.1';
export const WARNING_POLICY_VERSION = 'warnings.2026-10-21.2';
export const PRIVACY_POLICY_VERSION = 'privacy.2026-10-21.1';
export const CONSENT_VERSION = 'consent.2026-10-20.1';

export const POLICY = {
  pricing: PRICING_POLICY_VERSION,
  warnings: WARNING_POLICY_VERSION,
  privacy: PRIVACY_POLICY_VERSION,
} as const;

export const LIMITS = {
  maxBodyBytes: 256 * 1024,
  maxCandidates: 100,
  maxTargetsPerRequest: 20,
  maxConcurrentRequests: 2,
  maxTextCodepoints: 4000,
  maxExcerptCodepoints: 400,
  maxCachedAssessments: 200,
  maxComparables: 5,
  maxFindings: 3,
  assessmentTtlMs: 30 * 60_000,
  detailReuseMs: 10 * 60_000,
  openingTtlMs: 30 * 60_000,
  maxOpenings: 20,
} as const;
