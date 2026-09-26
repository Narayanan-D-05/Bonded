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

  return (
    <div>
      <Link href="/invoices" className="text-sm text-blue-600 hover:underline">
        ← Invoice Inbox
      </Link>
      <h1 className="mt-2 mb-4 text-2xl font-bold">World ID Step-Up</h1>

      {!proposal && (
        <p className="text-slate-600">
          No proposal specified. Go back to the <Link href="/invoices" className="text-blue-600 hover:underline">Invoice Inbox</Link>{' '}
          and open a held invoice.
        </p>
      )}

      {vendor && 'error' in vendor && (
        <div className="mb-4 rounded bg-red-50 px-4 py-3 text-sm text-red-800">Vendor-side request store: {vendor.error}</div>
      )}
      {vendor && 'gate' in vendor && (
        <div className={`mb-4 rounded px-4 py-3 text-sm ${vendor.gate.ok ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}>
          <div className="font-semibold">Vendor side (World ID via IDKit)</div>
          {vendor.gate.ok ? (
            <div>
              {vendor.vendorId} filed this exact change (payout <span className="font-mono text-xs">{vendor.payout}</span>, EVM identity{' '}
              <span className="font-mono text-xs">{vendor.evm}</span>) and verified it with the {vendor.gate.request.credentialType} credential
              (World ID {vendor.gate.request.protocolVersion}, {vendor.gate.request.environment}) at{' '}
              {new Date(vendor.gate.request.verifiedAtMs).toISOString()}. Verified person&apos;s nullifier for this action:{' '}
              <span className="font-mono text-xs">{vendor.gate.request.nullifier}</span>.
            </div>
          ) : (
            <div>
              {vendor.gate.detail} Until then, approving here is denied <span className="font-mono">no_verified_vendor_request</span>.{' '}
              <Link href="/vendor/bank-change" className="text-blue-700 hover:underline">
                Vendor portal →
              </Link>
            </div>
          )}
        </div>
      )}

      {proposal && !sp.decision && !settled && <StepUpActions proposalHash={proposal} />}

      {sp.decision === 'approved' && (
        <div className="rounded bg-green-100 px-4 py-3 text-sm text-green-800">Approved by World ID. sub={sp.sub ?? '(unknown)'}</div>
      )}
      {(sp.decision === 'denied' || sp.decision === 'error') && (
        <div className="rounded bg-red-100 px-4 py-3 text-sm text-red-800">
          {sp.decision === 'error' ? 'Error' : 'Denied'}: <span className="font-mono">{sp.reason ?? '(no reason given)'}</span>
          {sp.detail && <div className="mt-1">{sp.detail}</div>}
          {/* Read from the records, not assumed: the ledger and the vendor-master change log. */}
          {!settled && changes.length === 0 && (
            <div className="mt-1 font-semibold">
              Protected action did not occur: no payment was made and the vendor record was not changed.
            </div>
          )}
        </div>
      )}

      {changes.map((c) => (
        <div key={c.recordedAtMs} className="mt-4 rounded bg-slate-100 px-4 py-3 text-sm">
          Vendor master updated ({c.appliedTo}): {c.vendorId} payout{' '}
          <span className="font-mono text-xs">{c.previousPayoutAddress}</span> →{' '}
          <span className="font-mono text-xs">{c.newPayoutAddress}</span>, confirmed by World sub {c.approvedBy.worldSub}.
        </div>
      ))}

      {settled?.status === 'settled' && (
        <div className="mt-4 rounded bg-green-50 px-4 py-3 text-sm text-green-900">
          Settled on Sui testnet{settled.viaStepup ? ' (settle_with_stepup)' : ''}: digest{' '}
          <a href={settled.explorerUrl} className="font-mono text-blue-700 hover:underline">
            {settled.digest}
          </a>{' '}
          to <span className="font-mono text-xs">{settled.recipient}</span>.
        </div>
      )}
      {settled && settled.status !== 'settled' && (
        <div className="mt-4 rounded bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Settlement {settled.status}
          {settled.status === 'unknown' ? `: ${settled.error}` : ''}
        </div>
      )}
    </div>
  );
}
