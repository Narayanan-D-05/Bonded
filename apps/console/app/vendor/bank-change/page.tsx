import Link from 'next/link';
import { HALCYON_NEW_BANK_PAYOUT_ADDRESS, defaultConsoleContext, listDemoInvoices } from '../../../lib/enforce-deps';
import { defaultVendorRequestStorePath, readVendorBankChangeRequests } from '../../../lib/vendor-bank-change';
import { VendorBankChangeForm, type VendorOption } from './VendorBankChangeForm';

export const dynamic = 'force-dynamic';

/**
 * `/vendor/bank-change`: the VENDOR's page. A bank-change request is only on file if the person
 * submitting it verifies with World ID through IDKit (passport credential), bound by the proof's
 * signal to this vendor, this payout address and this EVM identity. The payer's AP controller can
 * only approve the matching held invoice (`/stepup`) when such a request exists.
 */
export default async function VendorBankChangePage() {
  const ctx = defaultConsoleContext();
  const invoices = await listDemoInvoices(ctx.vendorSource);
  const vendorIds = [...new Set(invoices.map((i) => i.vendorId))];
  const vendors: VendorOption[] = [];
  for (const id of vendorIds) {
    const t = await ctx.vendorSource(id);
    if (t !== null) vendors.push({ vendorId: t.vendorId, legalName: t.legalName, payoutAddress: t.payoutAddress, evmAddress: t.evmAddress });
  }
  const halcyon = vendors.find((v) => v.vendorId === 'vnd-halcyon-machining');
  const defaults = {
    vendorId: halcyon?.vendorId ?? vendors[0]?.vendorId ?? '',
    newPayoutAddress: HALCYON_NEW_BANK_PAYOUT_ADDRESS,
    newEvmAddress: halcyon?.evmAddress ?? '',
  };

  let requests: Awaited<ReturnType<typeof readVendorBankChangeRequests>> = [];
  let storeError: string | null = null;
  try {
    requests = await readVendorBankChangeRequests(defaultVendorRequestStorePath());
  } catch (error) {
    storeError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  return (
    <div>
      <Link href="/invoices" className="text-sm text-blue-600 hover:underline">
        ← Invoice Inbox
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-bold">Vendor portal: change bank details</h1>
      <p className="mb-6 text-sm text-slate-600">
        You are the vendor&apos;s representative. A request to change where your invoices are paid is accepted only if you verify with World ID
        using your passport credential. The proof is bound to this vendor, this payout address and this EVM identity, so it cannot be reused
        for any other address. Filing a request pays nothing and changes nothing on the payer&apos;s side: their AP controller still has to
        approve the held invoice with their own World ID check, and that approval only succeeds if it matches a request filed here.
      </p>
      <p className="mb-6 text-xs text-slate-500">
        Demo scenario: the defaults below are the new details claimed by invoice{' '}
        <Link href="/invoices/inv-halcyon-bank-change" className="text-blue-600 hover:underline">
          inv-halcyon-bank-change
        </Link>
        .
      </p>

      <VendorBankChangeForm vendors={vendors} defaults={defaults} />

      <h2 className="mt-10 mb-2 text-lg font-semibold">Verified requests on file</h2>
      {storeError && <div className="rounded bg-red-50 px-4 py-3 text-sm text-red-800">{storeError}</div>}
      {!storeError && requests.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
      {requests.length > 0 && (
        <ul className="space-y-2 text-xs">
          {[...requests].reverse().map((r) => (
            <li key={`${r.nullifier}-${r.signalHash}`} className="rounded bg-slate-50 px-3 py-2">
              <span className="font-semibold">{r.vendorId}</span> → payout <span className="font-mono">{r.newPayoutAddress}</span>, EVM{' '}
              <span className="font-mono">{r.newEvmAddress}</span>
              <div className="text-slate-500">
                {r.credentialType} (World ID {r.protocolVersion}) · {r.environment} · action {r.action} · nullifier {r.nullifier} ·{' '}
                {new Date(r.verifiedAtMs).toISOString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
