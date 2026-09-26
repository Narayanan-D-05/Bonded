import Link from 'next/link';
import type { Hash32 } from '@bonded/seam';
import { defaultVendorMasterChangeLogPath, readVendorMasterChanges } from '@bonded/issuer-oracle';
import { defaultConsoleContext } from '../../lib/enforce-deps';
import { StepUpActions } from './StepUpActions';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ proposal?: string; decision?: string; reason?: string; sub?: string }>;
}

/**
 * `/stepup`: the World ID step-up for one held proposal (`/stepup?proposal=<hash>`). After the
 * callback, shows what actually happened, read from the records themselves: the settlement ledger
 * (digest + suiscan link) and, for a bank change, the vendor-master change entry.
 */
export default async function StepUpPage({ searchParams }: Props) {
  const sp = await searchParams;
  const proposal = sp.proposal && /^0x[0-9a-fA-F]{64}$/.test(sp.proposal) ? (sp.proposal as Hash32) : null;

  const settled = proposal ? await defaultConsoleContext().ledger.get(proposal) : null;
  const changes = proposal
    ? (await readVendorMasterChanges(defaultVendorMasterChangeLogPath())).filter((c) => c.proposalHash.toLowerCase() === proposal.toLowerCase())
    : [];

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

      {proposal && !sp.decision && !settled && <StepUpActions proposalHash={proposal} />}

      {sp.decision === 'approved' && (
        <div className="rounded bg-green-100 px-4 py-3 text-sm text-green-800">Approved by World ID. sub={sp.sub ?? '(unknown)'}</div>
      )}
      {(sp.decision === 'denied' || sp.decision === 'error') && (
        <div className="rounded bg-red-100 px-4 py-3 text-sm text-red-800">
          {sp.decision === 'error' ? 'Error' : 'Denied'}: {sp.reason ?? '(no reason given)'}
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
