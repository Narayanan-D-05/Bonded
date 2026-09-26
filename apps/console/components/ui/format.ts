/** Unix ms → "2026-09-26 23:44:21 UTC". UTC only, so server and client render the same string. */
export function formatUtc(ms: number): string {
  return `${new Date(ms).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/**
 * Human labels for the premise fields the AP policy checks (lib/ap-policy.ts). Presentation only:
 * the premise-diff table still shows the raw field name under each label.
 */
const PREMISE_LABEL: Record<string, { label: string; source: string }> = {
  'payment.payTo.traitCount': { label: 'Risk traits on the claimed payee identity', source: 'Intercepta screen' },
  'vendor.status': { label: 'Vendor status', source: 'Vendor master' },
  'vendor.evmAddress': { label: 'Registered EVM identity', source: 'Vendor master' },
  'vendor.payoutAddress': { label: 'Payout address', source: 'Vendor master' },
};

export function premiseLabel(field: string): { label: string; source: string } {
  return PREMISE_LABEL[field] ?? { label: field, source: 'Re-derived' };
}
