import Link from 'next/link';
import { listDemoInvoices } from '../../lib/enforce-deps';

// Always re-fetches the real vendor fixture — never statically cached — since this is a
// demo of live re-derivation, not a static page.
export const dynamic = 'force-dynamic';

/**
 * Invoice Inbox — lists the three real demo invoices. Deliberately simple: vendor display
 * fields come from the real `@bonded/issuer-oracle` fixture via `fetchVendorTruth` (through
 * `listDemoInvoices`), but no verdict is computed or shown here. The actual `enforce()` call
 * happens only on the detail page (`/invoices/[id]`), so nothing on this list is precomputed
 * or hardcoded.
 */
export default async function InvoiceInboxPage() {
  const invoices = await listDemoInvoices();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Invoice Inbox</h1>
      <p className="mb-6 text-slate-600">
        Three real vendor invoices for an AP agent to review. Verdicts are computed on the
        detail page by a real <code className="rounded bg-slate-100 px-1">enforce()</code> call.
      </p>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-300 text-sm text-slate-500">
            <th className="py-2 pr-4">Vendor</th>
            <th className="py-2 pr-4">Claimed amount</th>
            <th className="py-2 pr-4">Claimed payout address</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.vendorId} className="border-b border-slate-100">
              <td className="py-3 pr-4">
                {invoice.legalName}{' '}
                <span className="text-xs text-slate-400">({invoice.vendorId})</span>
              </td>
              <td className="py-3 pr-4">{formatUsd(invoice.claimedInvoiceAmountUSD)}</td>
              <td className="py-3 pr-4 font-mono text-xs">{invoice.claimedPayoutAddress}</td>
              <td className="py-3 text-right">
                <Link href={`/invoices/${invoice.vendorId}`} className="text-blue-600 hover:underline">
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

/** 6-decimal fixed-point base-unit string -> "$1,250.00". `BigInt` arithmetic only — never `parseFloat` (CLAUDE.md rule 2). */
function formatUsd(baseUnits6Decimal: string): string {
  const amount = BigInt(baseUnits6Decimal);
  const dollars = amount / 1_000_000n;
  const cents = amount % 1_000_000n;
  const centsStr = cents.toString().padStart(6, '0').slice(0, 2);
  return `$${dollars.toLocaleString('en-US')}.${centsStr}`;
}
