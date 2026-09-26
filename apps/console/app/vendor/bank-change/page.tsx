import Link from 'next/link';
import { HALCYON_NEW_BANK_PAYOUT_ADDRESS, defaultConsoleContext, listDemoInvoices } from '../../../lib/enforce-deps';
import { defaultVendorRequestStorePath, readVendorBankChangeRequests } from '../../../lib/vendor-bank-change';
import { VendorBankChangeForm, type VendorOption } from './VendorBankChangeForm';
import { formatUtc } from '../../../components/ui/format';
import { Notice } from '../../../components/ui/Notice';
import { Panel } from '../../../components/ui/Panel';
import { PageHeader } from '../../../components/ui/PageHeader';

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
    <div className="space-y-8">
      <PageHeader
        kicker="Form V-1 · Vendor portal"
        title="Change bank details"
        lede={
          <>
            You are the vendor&apos;s representative. A request to change where your invoices are paid is accepted only if you verify with World ID
            using your passport credential. The proof is bound to this vendor, this payout address and this EVM identity, so it cannot be reused
            for any other address. Filing a request pays nothing and changes nothing on the payer&apos;s side: their AP controller still has to
            approve the held invoice with their own World ID check, and that approval only succeeds if it matches a request filed here.
          </>
        }
      >
        <p className="mt-4 text-sm text-fog">
          Demo scenario: the defaults below are the new details claimed by invoice{' '}
          <Link href="/invoices/inv-halcyon-bank-change" className="font-mono text-manifest underline underline-offset-2 hover:text-white">
            inv-halcyon-bank-change
          </Link>
          .
        </p>
      </PageHeader>

      <Panel label="Bank-change request · verified with World ID (IDKit)">
        <VendorBankChangeForm vendors={vendors} defaults={defaults} />
      </Panel>

      <section aria-labelledby="on-file">
        <h2 id="on-file" className="mb-3 text-xl font-semibold tracking-tight">
          Verified requests on file
        </h2>
        {storeError && (
          <Notice tone="error" role="alert" title="The request store could not be read">
            <span className="font-mono text-xs">{storeError}</span>
          </Notice>
        )}
        {!storeError && requests.length === 0 && <p className="text-sm text-fog">None yet.</p>}
        {requests.length > 0 && (
          <ul className="divide-y divide-hairline rounded-doc border border-hairline bg-deepwater">
            {[...requests].reverse().map((r) => (
              <li key={`${r.nullifier}-${r.signalHash}`} className="px-4 py-3 text-sm sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-semibold text-manifest">{r.vendorId}</span>
                  <span className="font-mono text-xs text-fog">{formatUtc(r.verifiedAtMs)}</span>
                </div>
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <dt className="text-fog">Payout</dt>
                  <dd className="break-all font-mono text-manifest">{r.newPayoutAddress}</dd>
                  <dt className="text-fog">EVM identity</dt>
                  <dd className="break-all font-mono text-manifest">{r.newEvmAddress}</dd>
                  <dt className="text-fog">Credential</dt>
                  <dd className="text-manifest">
                    {r.credentialType} (World ID {r.protocolVersion}) · {r.environment} · action <span className="font-mono">{r.action}</span>
                  </dd>
                  <dt className="text-fog">Nullifier</dt>
                  <dd className="break-all font-mono text-manifest">{r.nullifier}</dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
