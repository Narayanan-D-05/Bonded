/**
 * The verdict as a customs inspection stamp, pressed onto the black invoice document.
 * cleared (green) = CLEARED, refused (crimson) = REFUSED, held (yellow) = HELD_FOR_STEPUP. The word
 * is always printed, so colour is never the only signal, and none of the three is the Intercepta
 * box orange (contrast notes in tailwind.config.ts).
 *
 * `press` plays the site's one signature motion (`.stamp-press` in globals.css, ~180ms with
 * overshoot), and only when a verdict has just landed. Reduced motion shows it already pressed.
 */
export type Outcome = 'CLEARED' | 'REFUSED' | 'HELD_FOR_STEPUP';

const TONE: Record<Outcome, { cls: string; word: string; sub: string }> = {
  CLEARED: { cls: 'text-cleared border-cleared bg-cleared/[0.07]', word: 'CLEARED', sub: 'Released for settlement' },
  REFUSED: { cls: 'text-refused border-refused bg-refused/[0.09]', word: 'REFUSED', sub: 'Nothing is paid' },
  HELD_FOR_STEPUP: { cls: 'text-held border-held bg-held/[0.07]', word: 'HELD', sub: 'For a verified human' },
};

export function Stamp({ outcome, reason, press = false }: { outcome: Outcome; reason: string; press?: boolean }) {
  const t = TONE[outcome];
  return (
    <div
      role="img"
      aria-label={`Verdict: ${outcome}, reason ${reason}`}
      className={`stamp ${press ? 'stamp-press' : ''} inline-flex select-none flex-col items-center rounded-[4px] border-[3px] px-4 py-2 ${t.cls}`}
      style={{ boxShadow: 'inset 0 0 0 2px var(--panel), inset 0 0 0 3px currentColor' }}
    >
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.3em]">Bonded · Inspected</span>
      <span className="font-sans text-3xl font-bold leading-tight tracking-[0.12em] sm:text-4xl">{t.word}</span>
      <span className="max-w-[16rem] break-all text-center font-mono text-[11px] font-semibold uppercase tracking-wider">{reason}</span>
      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.2em]">{t.sub}</span>
    </div>
  );
}

const CHIP: Record<Outcome, { cls: string; word: string }> = {
  CLEARED: { cls: 'border-cleared text-cleared', word: 'Cleared' },
  REFUSED: { cls: 'border-refused text-refused', word: 'Refused' },
  HELD_FOR_STEPUP: { cls: 'border-held text-held', word: 'Held' },
};

/** A small labelled verdict pill on black, for legends and summaries. */
export function VerdictChip({ outcome, className = '' }: { outcome: Outcome; className?: string }) {
  const c = CHIP[outcome];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider ${c.cls} ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {c.word}
    </span>
  );
}
