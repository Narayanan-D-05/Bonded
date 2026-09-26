import Link from 'next/link';
import { StepUpActions } from './StepUpActions';

interface Props {
  searchParams: Promise<{ proposal?: string; decision?: string; reason?: string; sub?: string }>;
}

/**
 * `/stepup` — thin UI wrapper over `@bonded/world-agents`' step-up flow, reached from the
 * invoice detail page's HELD_FOR_STEPUP link (`/stepup?proposal=<hash>`). No new logic lives
 * here or in `StepUpActions.tsx`; both are wrappers over `app/api/stepup/route.ts`, which itself
 * only calls the already-built `initiateStepUp`/`handleCallback`/`decideStepUp`/
 * `fromHeldVerdict` exports.
 */
export default async function StepUpPage({ searchParams }: Props) {
  const sp = await searchParams;
  const proposal = sp.proposal ?? null;

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

      {proposal && !sp.decision && <StepUpActions proposalHash={proposal} />}

      {sp.decision === 'approved' && (
        <div className="rounded bg-green-100 px-4 py-3 text-sm text-green-800">
          Approved by World ID. sub={sp.sub ?? '(unknown)'}
        </div>
      )}

      {sp.decision === 'denied' && (
        <div className="rounded bg-red-100 px-4 py-3 text-sm text-red-800">Denied: {sp.reason ?? '(no reason given)'}</div>
      )}
    </div>
  );
}
