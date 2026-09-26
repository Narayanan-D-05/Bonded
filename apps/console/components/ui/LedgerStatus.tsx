import type { LedgerEntry } from '../../lib/settlement-ledger';
import type { VerdictLogEntry } from '../../lib/verdict-log';
import { SuiscanLink } from './ExternalLink';
import { SponsorLogo } from './SponsorLogo';

/**
 * An invoice's settlement status as the ledger records it, without running enforce():
 *  - settled → "Paid" (cleared green) with the Sui mark and the recorded digest's Suiscan link;
 *  - pending → a settlement is being submitted;
 *  - unknown → a submission may have happened; the ledger's own error is shown, never retried;
 *  - no entry → the agent's latest verdict if it has reviewed the invoice ("Refused" with the
 *    reason, "Held: needs approval", "Cleared, not yet paid"), else "Not reviewed yet" (the agent
 *    runs when the invoice is opened).
 * Every state is a word plus a colour (cleared / held / refused), never colour alone.
 */
export function LedgerStatus({
  entry,
  verdict = null,
}: {
  entry: LedgerEntry | null;
  /** The agent's latest verdict (lib/verdict-log.ts), shown only when nothing was paid. */
  verdict?: VerdictLogEntry | null;
}) {
  if (entry === null) {
    if (verdict?.outcomeLabel === 'REFUSED') {
      return (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 text-sm font-semibold text-refused">
          <span className="h-2 w-2 rounded-full bg-refused" aria-hidden="true" />
          Refused <span className="font-mono text-xs font-normal">{verdict.reasonCodeLabel}</span>
        </span>
      );
    }
    if (verdict?.outcomeLabel === 'HELD_FOR_STEPUP') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-held">
          <span className="h-2 w-2 rounded-full bg-held" aria-hidden="true" />
          Held: needs approval
        </span>
      );
    }
    if (verdict?.outcomeLabel === 'CLEARED') {
      return <span className="text-sm font-semibold text-cleared">Cleared, not yet paid</span>;
    }
    return <span className="text-sm text-muted">Not reviewed yet</span>;
  }
  if (entry.status === 'settled') {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-cleared">
          <span className="h-2 w-2 rounded-full bg-cleared" aria-hidden="true" />
          Paid{entry.viaStepup ? ' (step-up)' : ''}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <SponsorLogo sponsor="sui" size={14} />
          <span>Sui</span>
          <SuiscanLink explorerUrl={entry.explorerUrl} digest={entry.digest} className="text-sui" />
        </span>
      </span>
    );
  }
  if (entry.status === 'pending') {
    return <span className="text-sm font-semibold text-held">Settlement in progress</span>;
  }
  return (
    <span className="block text-sm text-refused">
      <span className="font-semibold">Settlement unknown: check the explorer.</span>{' '}
      <span className="break-words font-mono text-xs">{entry.error}</span>
    </span>
  );
}
