/**
 * Read-only access to the console's existing stores for the presentation pages. No new data
 * source: every read goes through the store's own existing reader.
 *
 *  - Settlement ledger: `SettlementLedger.get(proposalHash)` for each demo invoice's proposal id.
 *    The console only ever settles demo-invoice proposals (`payment.ts` calls `runOnce` with
 *    `verdict.proposalHash === proposalIdFor(invoiceId)`), so this reads every entry the app writes.
 *  - Vendor-master change log: `readVendorMasterChanges` from `@bonded/issuer-oracle`.
 *  - IDKit vendor bank-change requests: `readVendorBankChangeRequests`.
 *
 * Each read reports its own failure (a corrupt file throws in its reader and is never reset), so a
 * page shows exactly which store could not be read instead of an empty, reassuring list.
 */

import { defaultVendorMasterChangeLogPath, readVendorMasterChanges, type VendorMasterChange } from '@bonded/issuer-oracle';
import { DEMO_INVOICE_IDS, defaultConsoleContext, proposalIdFor, type DemoInvoiceId } from './enforce-deps';
import type { LedgerEntry } from './settlement-ledger';
import { defaultVendorRequestStorePath, readVendorBankChangeRequests, type VerifiedVendorBankChangeRequest } from './vendor-bank-change';

export type StoreRead<T> = { ok: true; value: T } | { ok: false; error: string };

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** The ledger entry (or null) for every demo invoice, in inbox order. */
export async function readDemoLedger(): Promise<StoreRead<{ invoiceId: DemoInvoiceId; entry: LedgerEntry | null }[]>> {
  try {
    const ledger = defaultConsoleContext().ledger;
    const rows = [];
    for (const invoiceId of DEMO_INVOICE_IDS) rows.push({ invoiceId, entry: await ledger.get(proposalIdFor(invoiceId)) });
    return { ok: true, value: rows };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function readVendorMasterChangeLog(): Promise<StoreRead<VendorMasterChange[]>> {
  try {
    return { ok: true, value: await readVendorMasterChanges(defaultVendorMasterChangeLogPath()) };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function readVendorRequests(): Promise<StoreRead<VerifiedVendorBankChangeRequest[]>> {
  try {
    return { ok: true, value: await readVendorBankChangeRequests(defaultVendorRequestStorePath()) };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}
