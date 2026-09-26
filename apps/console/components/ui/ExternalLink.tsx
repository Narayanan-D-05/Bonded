import type { ReactNode } from 'react';
import { truncateMiddle } from './Hash';

/** An outbound link (Suiscan, the IC3 report). Opens in a new tab and says so to screen readers. */
export function ExternalLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`underline decoration-1 underline-offset-2 transition-colors hover:opacity-80 ${className}`}
    >
      {children}
      <span aria-hidden="true"> ↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** A settlement digest, linked to the explorer URL the settlement itself recorded (never rebuilt). */
export function SuiscanLink({ explorerUrl, digest, full = false, className = '' }: { explorerUrl: string; digest: string; full?: boolean; className?: string }) {
  return (
    <ExternalLink href={explorerUrl} className={`font-mono ${className}`}>
      {full ? (
        <span className="break-all">{digest}</span>
      ) : (
        <span title={digest}>
          <span aria-hidden="true">{truncateMiddle(digest, 8, 6)}</span>
          <span className="sr-only">{digest}</span>
        </span>
      )}
      <span className="sr-only"> on Suiscan</span>
    </ExternalLink>
  );
}
