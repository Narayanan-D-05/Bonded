/**
 * Pure presentation helpers over the console's existing stores. No I/O here (see
 * `activity-source.ts` for the reads), so the Overview, Invoice Inbox and Activity pages all
 * summarise and order the same records the same way.
 *
 *  - `formatUsdc6`: 6-decimal base units → "1,250.00", bigint only (CLAUDE.md rule 2).
 *  - `summarizeSettlements`: invoices paid and total settled, from settlement-ledger entries.
 *  - `buildActivityTimeline`: one newest-first timeline over the settlement ledger, the
 *    vendor-master change log and the IDKit vendor bank-change requests.
 */

import type { VendorMasterChange } from '@bonded/issuer-oracle';
import { USDC_SCALE } from '@bonded/seam';
import type { LedgerEntry } from './settlement-ledger';
import type { VerifiedVendorBankChangeRequest } from './vendor-bank-change';

/** 6-decimal fixed-point base units → "1,234.56" (truncated below the cent, never rounded up). */
export function formatUsdc6(baseUnits: string | bigint): string {
  if (typeof baseUnits === 'string' && !/^[0-9]+$/.test(baseUnits)) {
    throw new Error(`Not a non-negative integer amount of base units: "${baseUnits}"`);
  }
  const v = typeof baseUnits === 'bigint' ? baseUnits : BigInt(baseUnits);
  if (v < 0n) throw new Error(`Negative amount: ${v}`);
  const whole = v / USDC_SCALE;
  const cents = (v % USDC_SCALE) / (USDC_SCALE / 100n);
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents.toString().padStart(2, '0')}`;
}

export type SettledLedgerEntry = Extract<LedgerEntry, { status: 'settled' }>;
export type UnresolvedLedgerEntry = Exclude<LedgerEntry, { status: 'settled' }>;

export interface SettlementSummary {
  paidCount: number;
  /** Sum of `valueUsdc` over settled entries, 6-decimal base units. */
  totalUsdc: bigint;
  /** Settled entries, newest first. */
  settled: SettledLedgerEntry[];
  /** Pending or unknown entries (not paid, or not known to be), oldest first. */
  unresolved: UnresolvedLedgerEntry[];
}

export function summarizeSettlements(entries: readonly LedgerEntry[]): SettlementSummary {
  const settled = entries.filter((e): e is SettledLedgerEntry => e.status === 'settled');
  const unresolved = entries.filter((e): e is UnresolvedLedgerEntry => e.status !== 'settled');
  return {
    paidCount: settled.length,
    totalUsdc: settled.reduce((sum, e) => sum + BigInt(e.valueUsdc), 0n),
    settled: [...settled].sort((a, b) => b.settledAtMs - a.settledAtMs),
    unresolved: [...unresolved].sort((a, b) => a.startedAtMs - b.startedAtMs),
  };
}

export type ActivityEvent =
  | { kind: 'settlement'; atMs: number; entry: LedgerEntry }
  | { kind: 'vendor-master-change'; atMs: number; change: VendorMasterChange }
  | { kind: 'vendor-request'; atMs: number; request: VerifiedVendorBankChangeRequest };

const KIND_ORDER: Record<ActivityEvent['kind'], number> = { settlement: 0, 'vendor-master-change': 1, 'vendor-request': 2 };

export interface ActivitySources {
  ledger: readonly LedgerEntry[];
  vendorMasterChanges: readonly VendorMasterChange[];
  vendorRequests: readonly VerifiedVendorBankChangeRequest[];
}

/**
 * Newest first. A settled entry is dated when it settled; a pending/unknown one when it started.
 * Equal timestamps keep a fixed order (settlement, then vendor-master change, then vendor request),
 * so the page never reshuffles between renders.
 */
export function buildActivityTimeline(sources: ActivitySources): ActivityEvent[] {
  const events: ActivityEvent[] = [
    ...sources.ledger.map((entry): ActivityEvent => ({
      kind: 'settlement',
      atMs: entry.status === 'settled' ? entry.settledAtMs : entry.startedAtMs,
      entry,
    })),
    ...sources.vendorMasterChanges.map((change): ActivityEvent => ({ kind: 'vendor-master-change', atMs: change.recordedAtMs, change })),
    ...sources.vendorRequests.map((request): ActivityEvent => ({ kind: 'vendor-request', atMs: request.verifiedAtMs, request })),
  ];
  return events.sort((a, b) => b.atMs - a.atMs || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}
