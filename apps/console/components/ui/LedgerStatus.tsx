import type { LedgerEntry } from '../../lib/settlement-ledger';
import { SuiscanLink } from './ExternalLink';

/**
 * An invoice's settlement status as the ledger records it, without running enforce():
 *  - settled → "Paid" with the recorded digest's Suiscan link;
 *  - pending → a settlement is being submitted;
 *  - unknown → a submission may have happened; the ledger's own error is shown, never retried;
 *  - no entry → "Awaiting agent" (the agent proposes it when the invoice is opened).
 * `tone` picks colours for the dark canvas or for manifest paper.
 */
export function LedgerStatus({ entry, tone = 'paper' }: { entry: LedgerEntry | null; tone?: 'paper' | 'dark' }) {
  const paper = tone === 'paper';
  if (entry === null) {
    return <span className={`text-sm ${paper ? 'text-ink/70' : 'text-fog'}`}>Awaiting agent</span>;
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
