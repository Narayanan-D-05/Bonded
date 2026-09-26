import type { LedgerEntry } from '../../lib/settlement-ledger';
import type { VerdictLogEntry } from '../../lib/verdict-log';
import { SuiscanLink } from './ExternalLink';

/**
 * An invoice's settlement status as the ledger records it, without running enforce():
 *  - settled → "Paid" with the recorded digest's Suiscan link;
 *  - pending → a settlement is being submitted;
 *  - unknown → a submission may have happened; the ledger's own error is shown, never retried;
 *  - no entry → the agent's latest verdict if it has reviewed the invoice ("Refused" with the
 *    reason, "Held: needs approval", "Cleared, not yet paid"), else "Not reviewed yet" (the agent
 *    runs when the invoice is opened).
 * `tone` picks colours for the dark canvas or for manifest paper.
 */
export function LedgerStatus({
  entry,
  verdict = null,
  tone = 'paper',
}: {
  entry: LedgerEntry | null;
  /** The agent's latest verdict (lib/verdict-log.ts), shown only when nothing was paid. */
  verdict?: VerdictLogEntry | null;
  tone?: 'paper' | 'dark';
}) {
  const paper = tone === 'paper';
  if (entry === null) {
    if (verdict?.outcomeLabel === 'REFUSED') {
      return (
        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${paper ? 'text-stamp-ink' : 'text-stamp-lit'}`}>
          <span className={`h-2 w-2 rounded-full ${paper ? 'bg-stamp-ink' : 'bg-stamp-lit'}`} aria-hidden="true" />
          Refused <span className="font-mono text-xs font-normal">{verdict.reasonCodeLabel}</span>
        </span>
      );
    }
    if (verdict?.outcomeLabel === 'HELD_FOR_STEPUP') {
      return (
        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${paper ? 'text-hold-ink' : 'text-hold'}`}>
          <span className={`h-2 w-2 rounded-full ${paper ? 'bg-hold-ink' : 'bg-hold'}`} aria-hidden="true" />
          Held: needs approval
        </span>
      );
    }
    if (verdict?.outcomeLabel === 'CLEARED') {
      return <span className={`text-sm font-semibold ${paper ? 'text-seal-ink' : 'text-seal'}`}>Cleared, not yet paid</span>;
    }
    return <span className={`text-sm ${paper ? 'text-ink/70' : 'text-fog'}`}>Not reviewed yet</span>;
  }
  if (entry.status === 'settled') {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${paper ? 'text-seal-ink' : 'text-seal'}`}>
          <span className={`h-2 w-2 rounded-full ${paper ? 'bg-seal-ink' : 'bg-seal'}`} aria-hidden="true" />
          Paid{entry.viaStepup ? ' (step-up)' : ''}
        </span>
        <SuiscanLink explorerUrl={entry.explorerUrl} digest={entry.digest} className={`text-xs ${paper ? 'text-ink' : 'text-manifest'}`} />
      </span>
    );
  }
  if (entry.status === 'pending') {
    return <span className={`text-sm font-semibold ${paper ? 'text-hold-ink' : 'text-hold'}`}>Settlement in progress</span>;
  }
  return (
    <span className={`block text-sm ${paper ? 'text-stamp-ink' : 'text-stamp-lit'}`}>
      <span className="font-semibold">Settlement unknown: check the explorer.</span>{' '}
      <span className="break-words font-mono text-xs">{entry.error}</span>
    </span>
  );
}
