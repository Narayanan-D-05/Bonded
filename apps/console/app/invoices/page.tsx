import Link from 'next/link';
import { formatUsdc6 } from '../../lib/activity';
import { readDemoLedger } from '../../lib/activity-source';
import { defaultConsoleContext, listDemoInvoices } from '../../lib/enforce-deps';
import type { LedgerEntry } from '../../lib/settlement-ledger';
import { Hash } from '../../components/ui/Hash';
import { LedgerStatus } from '../../components/ui/LedgerStatus';
import { Notice } from '../../components/ui/Notice';
import { PageHeader } from '../../components/ui/PageHeader';

// Always re-reads the vendor master and the ledger: this is a demo of live re-derivation.
export const dynamic = 'force-dynamic';

/**
 * Invoice Inbox: the six demo invoices the AP agent has to pay. Opening one is the agent
 * proposing that payment (`POST /api/enforce`); a CLEARED verdict settles on Sui without any human
 * click. No verdict is computed on this list: the status column is read from the settlement ledger
 * only (Paid with its digest, or "Awaiting agent").
 */
export default async function InvoiceInboxPage() {
  const invoices = await listDemoInvoices(defaultConsoleContext().vendorSource);
  const ledger = await readDemoLedger();
  const entryOf = new Map<string, LedgerEntry | null>(ledger.ok ? ledger.value.map((r) => [r.invoiceId, r.entry]) : []);

  const needsLabel = (needs: string[]) => (needs.length === 0 ? 'No keys' : needs.join(', '));

  return (
    <div>
      <PageHeader
        kicker="Form AP-1 · Invoice manifest"
        title="Invoice Inbox"
        lede={
          <>
            Opening an invoice has the AP agent propose its payment. The real <code className="font-mono text-manifest">enforce()</code> verdict
            decides: <span className="text-seal">CLEARED</span> settles on Sui, <span className="text-hold">HELD</span> waits for a World ID step-up,{' '}
            <span className="text-stamp-lit">REFUSED</span> pays nothing. Nothing is checked on this list; the status is what the settlement
            ledger records.
          </>
        }
      />

      {!ledger.ok && (
        <Notice tone="error" role="alert" title="Settlement status unavailable: the ledger could not be read" className="mb-6">
          <span className="font-mono text-xs">{ledger.error}</span>
        </Notice>
      )}

      <div className="paper overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/70">Kestrel Components · accounts payable</p>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/70">{invoices.length} invoices</p>
        </div>

        {/* md and up: the manifest table */}
        <table className="hidden w-full border-collapse text-left md:table">
          <caption className="sr-only">Demo invoices awaiting payment, with the settlement status from the ledger</caption>
          <thead>
            <tr className="perforation font-mono text-[11px] uppercase tracking-wider text-ink/70">
              <th scope="col" className="px-5 py-2.5 font-semibold">Vendor</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Amount</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Claimed payout</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
              <th scope="col" className="px-5 py-2.5">
                <span className="sr-only">Review</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.invoiceId} className="border-t border-ink/10 align-top">
                <td className="px-5 py-4">
                  <div className="font-semibold text-ink">{inv.legalName}</div>
                  <div className="mt-0.5 font-mono text-xs text-ink/70">{inv.invoiceId}</div>
                  <div className="mt-1 text-xs text-ink/70">
                    <span className="font-medium">Needs:</span> <span className="break-words font-mono">{needsLabel(inv.needs)}</span>
                  </div>
                </td>
                <td className="px-3 py-4 text-right font-mono text-sm font-semibold text-ink">${formatUsdc6(inv.claimedInvoiceAmountUSD)}</td>
                <td className="px-3 py-4 text-xs text-ink">
                  <Hash value={inv.claimedPayoutAddress} />
                </td>
                <td className="px-3 py-4">
                  <LedgerStatus entry={entryOf.get(inv.invoiceId) ?? null} />
                </td>
                <td className="px-5 py-4 text-right">
                  <Link
                    href={`/invoices/${inv.invoiceId}`}
                    className="inline-flex whitespace-nowrap rounded-control border border-ink/25 px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-manifest"
                  >
                    Review <span aria-hidden="true">&nbsp;→</span>
                    <span className="sr-only"> {inv.invoiceId}</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* below md: one card per invoice, same data */}
        <ul className="md:hidden">
          {invoices.map((inv) => (
            <li key={inv.invoiceId} className="border-t border-ink/10 px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-ink">{inv.legalName}</div>
                  <div className="font-mono text-xs text-ink/70">{inv.invoiceId}</div>
                </div>
                <div className="shrink-0 font-mono text-sm font-semibold text-ink">${formatUsdc6(inv.claimedInvoiceAmountUSD)}</div>
              </div>
              <dl className="mt-3 space-y-1 text-xs text-ink">
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-ink/70">Payout</dt>
                  <dd className="min-w-0">
                    <Hash value={inv.claimedPayoutAddress} />
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-ink/70">Needs</dt>
                  <dd className="min-w-0 break-words font-mono">{needsLabel(inv.needs)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-ink/70">Status</dt>
                  <dd className="min-w-0">
                    <LedgerStatus entry={entryOf.get(inv.invoiceId) ?? null} />
                  </dd>
                </div>
              </dl>
              <Link
                href={`/invoices/${inv.invoiceId}`}
                className="mt-3 inline-flex rounded-control border border-ink/25 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-ink hover:text-manifest"
              >
                Review <span aria-hidden="true">&nbsp;→</span>
                <span className="sr-only"> {inv.invoiceId}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-fog">
        Amounts are the invoice’s claimed amount in 6-decimal fixed point. “Needs” lists the keys an invoice requires to run live; without them it
        fails visibly (for example, the Intercepta screen fails closed and the invoice is refused). Reviewing an invoice runs the agent.
      </p>
    </div>
  );
}
