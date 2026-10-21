import type { Finding, ReasonCode } from './assess';

export type WarningLabel = 'suspicious' | 'check_details';

export const REASON_SEVERITY = {
  payment_before_viewing: 'suspicious',
  shipping_only: 'suspicious',
  mileage_mismatch: 'check_details',
  year_mismatch: 'check_details',
  fuel_mismatch: 'check_details',
  transmission_mismatch: 'check_details',
  private_seller_business_wording: 'check_details',
  service_history_conflict: 'check_details',
} as const satisfies Record<ReasonCode, WarningLabel>;

export function warningLabel(findings: readonly Finding[]): WarningLabel | null {
  if (findings.some((finding) => REASON_SEVERITY[finding.reason] === 'suspicious')) return 'suspicious';
  return findings.length > 0 ? 'check_details' : null;
}

export function bySeverity(a: Finding, b: Finding): number {
  const rank = (finding: Finding) => (REASON_SEVERITY[finding.reason] === 'suspicious' ? 0 : 1);
  return rank(a) - rank(b);
}
