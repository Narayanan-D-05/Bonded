import Link from 'next/link';
import type { Hash32 } from '@bonded/seam';
import { defaultVendorMasterChangeLogPath, readVendorMasterChanges } from '@bonded/issuer-oracle';
import { buildDemoInvoice, defaultConsoleContext, findInvoiceIdByProposalHash } from '../../lib/enforce-deps';
import {
  checkVendorRequestGate,
  defaultVendorRequestStorePath,
  readVendorBankChangeRequests,
  type VendorRequestGateResult,
} from '../../lib/vendor-bank-change';
import { StepUpActions } from './StepUpActions';
import { SuiscanLink } from '../../components/ui/ExternalLink';
import { formatUtc } from '../../components/ui/format';
import { Notice } from '../../components/ui/Notice';
import { Field, Panel } from '../../components/ui/Panel';
import { Accent, PageHero, Section } from '../../components/ui/PageHeader';
import { SponsorLogo, SponsorTag } from '../../components/ui/SponsorLogo';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ proposal?: string; decision?: string; reason?: string; detail?: string; sub?: string }>;
}

/**
 * `/stepup`: the World ID step-up for one held proposal (`/stepup?proposal=<hash>`). After the
 * callback, shows what actually happened, read from the records themselves: the settlement ledger
 * (digest + suiscan link) and, for a bank change, the vendor-master change entry.
 *
 * For a bank-change hold it also shows the VENDOR side, read from the IDKit request store: whether
 * the vendor filed this exact change (payout address + EVM identity) and verified it with World ID.
 * Without one, the controller's approval is denied `no_verified_vendor_request` (lib/payment.ts).
 */
async function vendorSide(proposal: Hash32): Promise<{ vendorId: string; payout: string; evm: string; gate: VendorRequestGateResult } | { error: string } | null> {
  const invoiceId = findInvoiceIdByProposalHash(proposal);
  if (invoiceId === null) return null;
  const ctx = defaultConsoleContext();
  try {
    const invoice = await buildDemoInvoice(invoiceId, ctx.vendorSource);
    const truth = await ctx.vendorSource(invoice.vendorId);
    // Only a bank-change invoice (claimed payout differs from the one on file, or was changed by this proposal).
    const changes = await readVendorMasterChanges(defaultVendorMasterChangeLogPath());
    const changedHere = changes.some((c) => c.proposalHash.toLowerCase() === proposal.toLowerCase());
    if (truth === null || (truth.payoutAddress === invoice.claimedPayoutAddress && !changedHere)) return null;
    const requests = await readVendorBankChangeRequests(defaultVendorRequestStorePath());
    const gate = changedHere
      ? // After the change the on-file timestamp moved past the request; show the request that was matched.
        checkVendorRequestGate(requests, {
          vendorId: invoice.vendorId,
          claimedPayoutAddress: invoice.claimedPayoutAddress,
          claimedEvmAddress: invoice.claimedPayeeEvmAddress,
          payoutAddressLastChangedAt: 0,
        })
      : checkVendorRequestGate(requests, {
          vendorId: invoice.vendorId,
          claimedPayoutAddress: invoice.claimedPayoutAddress,
          claimedEvmAddress: invoice.claimedPayeeEvmAddress,
          payoutAddressLastChangedAt: truth.payoutAddressLastChangedAt,
        });
    // A change applied before this gate existed (the live globex one) has no request to show.
    if (changedHere && !gate.ok) return null;
    return { vendorId: invoice.vendorId, payout: invoice.claimedPayoutAddress, evm: invoice.claimedPayeeEvmAddress, gate };
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

/** The `/stepup` page itself; see the comment above `vendorSide`. */
export default async function StepUpPage({ searchParams }: Props) {
  const sp = await searchParams;
  const proposal = sp.proposal && /^0x[0-9a-fA-F]{64}$/.test(sp.proposal) ? (sp.proposal as Hash32) : null;

  const settled = proposal ? await defaultConsoleContext().ledger.get(proposal) : null;
  const changes = proposal
    ? (await readVendorMasterChanges(defaultVendorMasterChangeLogPath())).filter((c) => c.proposalHash.toLowerCase() === proposal.toLowerCase())
    : [];
  const vendor = proposal ? await vendorSide(proposal) : null;

  const invoiceId = proposal ? findInvoiceIdByProposalHash(proposal) : null;
  const hasResult = Boolean(sp.decision) || changes.length > 0 || Boolean(settled);

  return (
    <>
      <PageHero
        eyebrow="Form AP-3 · Human step-up · World ID for Agents"
        title={
          <>
            The one <Accent>human moment</Accent> in the payment flow.
          </>
        }
        back={{ href: invoiceId ? `/invoices/${invoiceId}` : '/invoices', label: invoiceId ? `Back to ${invoiceId}` : 'Invoice Inbox' }}
        lede="A held proposal is released only when a live person approves this exact proposal with a fresh World ID check; the approval is then re-checked against the records before anything moves."
      >
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted">
          <SponsorTag sponsor="world" size={24} label="World ID for Agents: fresh proof of a live person" className="font-medium text-navy" />
          <SponsorTag sponsor="sui" size={24} label="Sui: settle_with_stepup, once" className="font-medium text-navy" />
        </div>
      </PageHero>

      <Section tone="deep" eyebrow="The proposal" title="What is waiting for approval">
        <div className="space-y-6">
          {!proposal && (
            <Notice tone="info" title="No proposal specified">
              Go back to the{' '}
              <Link href="/invoices" className="text-sui underline underline-offset-2 hover:text-navy">
                Invoice Inbox
              </Link>{' '}
              and open a held invoice.
            </Notice>
          )}

          {proposal && (
            <Panel label="Held proposal" aside={invoiceId ?? 'not a demo invoice'}>
              <dl>
                <Field label="proposalHash">{proposal}</Field>
              </dl>
            </Panel>
          )}

          {vendor && 'error' in vendor && (
            <Notice tone="error" role="alert" title="Vendor-side request store could not be read">
              <span className="font-mono text-xs">{vendor.error}</span>
            </Notice>
          )}
          {vendor && 'gate' in vendor && (
            <Panel
              label="Vendor side · World ID via IDKit"
              sponsor="world"
              aside={
                vendor.gate.ok ? (
                  <span className="font-semibold text-cleared">Verified request on file</span>
                ) : (
                  <span className="font-semibold text-held">No matching request</span>
                )
              }
            >
              {vendor.gate.ok ? (
                <>
                  <p className="mb-2 text-sm text-muted">
                    {vendor.vendorId} filed this exact change and verified it with the {vendor.gate.request.credentialType} credential (World ID{' '}
                    {vendor.gate.request.protocolVersion}, {vendor.gate.request.environment}).
                  </p>
                  <dl>
                    <Field label="Vendor" mono={false}>
                      {vendor.vendorId}
                    </Field>
                    <Field label="New payout">{vendor.payout}</Field>
                    <Field label="EVM identity">{vendor.evm}</Field>
                    <Field label="Verified at">{new Date(vendor.gate.request.verifiedAtMs).toISOString()}</Field>
                    <Field label="Nullifier">
                      {vendor.gate.request.nullifier}
                      <span className="mt-0.5 block font-sans text-xs text-muted">The verified person’s pseudonym for this action.</span>
                    </Field>
                  </dl>
                </>
              ) : (
                <div className="space-y-3 text-sm">
                  <p className="text-navy/90">
                    {vendor.gate.detail} Until then, approving here is denied <span className="font-mono text-held">no_verified_vendor_request</span>.
                  </p>
                  <Link href="/vendor/bank-change" className="inline-block text-sm font-semibold text-sui underline underline-offset-2 hover:text-navy">
                    Vendor portal <span aria-hidden="true">→</span>
                  </Link>
                </div>
              )}
            </Panel>
          )}
        </div>
      </Section>

      {proposal && !sp.decision && !settled && (
        <Section tone="band" eyebrow="Approve" title="Approve with a fresh World ID check">
          <StepUpActions proposalHash={proposal} />
        </Section>
      )}

      {hasResult && (
        <Section tone={proposal && !sp.decision && !settled ? 'deep' : 'band'} eyebrow="Result" title="What actually happened" lede="Read from the records themselves: the settlement ledger and the vendor-master change log.">
          <div className="space-y-6">
            {sp.decision === 'approved' && (
              <Notice tone="ok" role="status" title={<span className="inline-flex items-center gap-2"><SponsorLogo sponsor="world" size={18} />Approved by World ID</span>}>
                <span className="font-mono text-xs">sub={sp.sub ?? '(unknown)'}</span>
              </Notice>
            )}
            {(sp.decision === 'denied' || sp.decision === 'error') && (
              <Notice tone="error" role="alert" title={sp.decision === 'error' ? 'Error' : 'Denied'}>
                <span className="font-mono text-sm">{sp.reason ?? '(no reason given)'}</span>
                {sp.detail && <div className="mt-1">{sp.detail}</div>}
                {/* Read from the records, not assumed: the ledger and the vendor-master change log. */}
                {!settled && changes.length === 0 && (
                  <div className="mt-2 font-semibold text-navy">
                    Protected action did not occur: no payment was made and the vendor record was not changed.
                  </div>
                )}
              </Notice>
            )}

            {changes.map((c) => (
              <Panel key={c.recordedAtMs} label={`Vendor master updated (${c.appliedTo})`} sponsor="world" aside={formatUtc(c.recordedAtMs)}>
                <dl>
                  <Field label="Vendor" mono={false}>
                    {c.vendorId}
                  </Field>
                  <Field label="Previous payout">{c.previousPayoutAddress}</Field>
                  <Field label="New payout">{c.newPayoutAddress}</Field>
                  <Field label="Confirmed by">World sub {c.approvedBy.worldSub}</Field>
                </dl>
              </Panel>
            ))}

            {settled?.status === 'settled' && (
              <Panel label="Settlement on Sui" sponsor="sui" aside={<span className="font-semibold text-cleared">Settled</span>}>
                <p className="mb-2 text-sm text-muted">Settled on Sui testnet{settled.viaStepup ? ' (settle_with_stepup)' : ''}.</p>
                <dl>
                  <Field label="Digest">
                    <span className="inline-flex items-start gap-1.5">
                      <SponsorLogo sponsor="sui" size={16} className="mt-0.5" />
                      <SuiscanLink explorerUrl={settled.explorerUrl} digest={settled.digest} full className="text-sui" />
                    </span>
                  </Field>
                  <Field label="Recipient">{settled.recipient}</Field>
                  <Field label="Settled at">{formatUtc(settled.settledAtMs)}</Field>
                </dl>
              </Panel>
            )}
            {settled && settled.status !== 'settled' && (
              <Notice tone="hold" role="status" title={`Settlement ${settled.status}`}>
                {settled.status === 'unknown' ? <span className="font-mono text-xs">{settled.error}</span> : null}
              </Notice>
            )}
          </div>
        </Section>
      )}

      <Section tone={hasResult ? 'deep' : 'deep'} eyebrow="Why a person, and only here" title="How the step-up is checked">
        <div className="grid gap-5 md:grid-cols-3">
          <Panel label="1 · Only for held proposals" sponsor="world">
            <p className="text-sm leading-relaxed text-muted">
              The step-up starts only after the server re-derives that this proposal is genuinely held. A changed payout address or an amount over the
              irreversible threshold is held; routine payments never see a button.
            </p>
          </Panel>
          <Panel label="2 · A fresh proof, for this proposal" sponsor="world">
            <p className="text-sm leading-relaxed text-muted">
              World ID for Agents is asked for a new proof of a live person (max_age=0), bound to this one proposal. The ID token’s signature,
              freshness and assurance level are checked before anything else happens.
            </p>
          </Panel>
          <Panel label="3 · Re-checked, then settled once" sponsor="sui">
            <p className="text-sm leading-relaxed text-muted">
              A bank change is written to the vendor record first and the invoice is re-enforced; a large invoice settles with settle_with_stepup to the
              address on file. The on-chain verdict is consumed, so it cannot be paid twice.
            </p>
          </Panel>
        </div>
      </Section>
    </>
  );
}
