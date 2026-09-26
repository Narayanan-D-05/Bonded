import Link from 'next/link';
import { defaultConsoleContext, listDemoInvoices } from '../../lib/enforce-deps';

// Always re-reads the vendor master: this is a demo of live re-derivation.
export const dynamic = 'force-dynamic';

/**
 * Invoice Inbox: the five demo invoices the AP agent has to pay. Opening one is the agent
 * proposing that payment (`POST /api/enforce`); a CLEARED verdict settles on Sui without any human
 * click. No verdict is computed on this list.
 */
export default async function InvoiceInboxPage() {
  const invoices = await listDemoInvoices(defaultConsoleContext().vendorSource);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Invoice Inbox</h1>
      <p className="mb-6 text-slate-600">
        Opening an invoice has the AP agent propose its payment. The real <code className="rounded bg-slate-100 px-1">enforce()</code>{' '}
        verdict decides: CLEARED settles on Sui, HELD waits for a World ID step-up, REFUSED pays nothing.
      </p>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-300 text-sm text-slate-500">
            <th className="py-2 pr-4">Vendor</th>
            <th className="py-2 pr-4">Claimed amount</th>
            <th className="py-2 pr-4">Claimed payout address</th>
            <th className="py-2 pr-4">Needs</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.invoiceId} className="border-b border-slate-100">
              <td className="py-3 pr-4">
                {invoice.legalName} <span className="text-xs text-slate-400">({invoice.invoiceId})</span>
              </td>
              <td className="py-3 pr-4">{formatUsd(invoice.claimedInvoiceAmountUSD)}</td>
              <td className="py-3 pr-4 font-mono text-xs">{invoice.claimedPayoutAddress}</td>
              <td className="py-3 pr-4 text-xs text-slate-500">{invoice.needs.length === 0 ? 'no keys' : invoice.needs.join(', ')}</td>
              <td className="py-3 text-right">
                <Link href={`/invoices/${invoice.invoiceId}`} className="text-blue-600 hover:underline">
                  Review →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 6-decimal fixed-point base units -> "$1,250.00", bigint only (CLAUDE.md rule 2). */
function formatUsd(baseUnits6Decimal: string): string {
  const amount = BigInt(baseUnits6Decimal);
  const dollars = amount / 1_000_000n;
  const cents = (amount % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `$${dollars.toLocaleString('en-US')}.${cents}`;
}
