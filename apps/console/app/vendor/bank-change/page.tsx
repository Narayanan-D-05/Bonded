import Link from 'next/link';
import { HALCYON_NEW_BANK_PAYOUT_ADDRESS, defaultConsoleContext, listDemoInvoices } from '../../../lib/enforce-deps';
import { defaultVendorRequestStorePath, readVendorBankChangeRequests } from '../../../lib/vendor-bank-change';
import { VendorBankChangeForm, type VendorOption } from './VendorBankChangeForm';
import { formatUtc } from '../../../components/ui/format';
import { Notice } from '../../../components/ui/Notice';
import { Panel } from '../../../components/ui/Panel';
import { Accent, PageHero, Section } from '../../../components/ui/PageHeader';
import { SponsorLogo, SponsorTag } from '../../../components/ui/SponsorLogo';

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
    <>
      <PageHero
        eyebrow="Form V-1 · Vendor portal · World IDKit"
        title={
          <>
            Change your bank details, <Accent>provably.</Accent>
          </>
        }
        lede={
          <>
            You are the vendor&apos;s representative. A request to change where your invoices are paid is accepted only if you verify with World ID
            using your passport credential. The proof is bound to this vendor, this payout address and this EVM identity, so it cannot be reused
            for any other address. Filing a request pays nothing and changes nothing on the payer&apos;s side: their AP controller still has to
            approve the held invoice with their own World ID check, and that approval only succeeds if it matches a request filed here.
          </>
        }
      >
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <SponsorTag sponsor="world" size={24} label="Verified with World ID via IDKit (passport)" className="text-sm font-medium text-navy" />
        </div>
        <p className="mt-6 text-sm text-muted">
          Demo scenario: the defaults below are the new details claimed by invoice{' '}
          <Link href="/invoices/inv-halcyon-bank-change" className="font-mono text-sui underline underline-offset-2 hover:text-navy">
            inv-halcyon-bank-change
          </Link>
          .
        </p>
      </PageHero>

      <Section tone="deep" eyebrow="File a request" title="Bank-change request">
        <Panel label="Bank-change request · verified with World ID (IDKit)" sponsor="world" className="max-w-4xl">
          <VendorBankChangeForm vendors={vendors} defaults={defaults} />
        </Panel>
      </Section>

      <Section
        tone="band"
        eyebrow="How your request is checked"
        title="Two people, two World ID checks, one address"
        lede="A bank change is the moment Business Email Compromise targets, so it needs both sides to prove who they are."
      >
        <ol className="grid gap-5 md:grid-cols-3">
          <Panel as="li" label="1 · You verify" sponsor="world">
            <p className="text-sm leading-relaxed text-muted">
              IDKit asks World for a proof from your passport credential. The server signs the request and binds this vendor, payout address and EVM
              identity into the proof&apos;s signal, then verifies the result with World before recording it.
            </p>
          </Panel>
          <Panel as="li" label="2 · The invoice is held">
            <p className="text-sm leading-relaxed text-muted">
              When an invoice claims the new address, Bonded sees it differs from the vendor master and holds the payment. Nothing is paid to an
              address the records do not hold.
            </p>
          </Panel>
          <Panel as="li" label="3 · The payer approves" sponsor="world">
            <p className="text-sm leading-relaxed text-muted">
              The payer&apos;s controller approves with their own fresh World ID check. It succeeds only if it matches a verified request filed here;
              then the vendor record is updated and the invoice clears and settles on Sui.
            </p>
          </Panel>
        </ol>
      </Section>

      <Section tone="deep" eyebrow="Records" title="Verified requests on file">
        {storeError && (
          <Notice tone="error" role="alert" title="The request store could not be read">
            <span className="font-mono text-xs">{storeError}</span>
          </Notice>
        )}
        {!storeError && requests.length === 0 && (
          <Panel label="Requests" sponsor="world">
            <p className="text-sm text-muted">None yet.</p>
          </Panel>
        )}
        {requests.length > 0 && (
          <Panel label="Requests" sponsor="world" aside={`${requests.length} on file`} bodyClassName="">
            <ul className="divide-y divide-rule">
              {[...requests].reverse().map((r) => (
                <li key={`${r.nullifier}-${r.signalHash}`} className="px-5 py-4 text-sm sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-2 font-semibold text-navy">
                      <SponsorLogo sponsor="world" size={16} />
                      {r.vendorId}
                    </span>
                    <span className="font-mono text-xs text-muted">{formatUtc(r.verifiedAtMs)}</span>
                  </div>
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_minmax(0,1fr)]">
                    <dt className="text-muted">Payout</dt>
                    <dd className="break-all font-mono text-navy">{r.newPayoutAddress}</dd>
                    <dt className="text-muted">EVM identity</dt>
                    <dd className="break-all font-mono text-navy">{r.newEvmAddress}</dd>
                    <dt className="text-muted">Credential</dt>
                    <dd className="text-navy">
                      {r.credentialType} (World ID {r.protocolVersion}) · {r.environment} · action <span className="font-mono">{r.action}</span>
                    </dd>
                    <dt className="text-muted">Nullifier</dt>
                    <dd className="break-all font-mono text-navy">{r.nullifier}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </Section>
    </>
  );
}
