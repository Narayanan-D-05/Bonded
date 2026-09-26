/**
 * The verdict as a customs inspection stamp, pressed onto a manifest-paper surface.
 * seal = CLEARED, stamp = REFUSED, hold = HELD_FOR_STEPUP. The colours are the `-ink` variants
 * because the stamp sits on paper (contrast notes in tailwind.config.ts).
 *
 * `press` plays the site's one signature motion (`.stamp-press` in globals.css, ~180ms with
 * overshoot), and only when a verdict has just landed. Reduced motion shows it already pressed.
 */
export type Outcome = 'CLEARED' | 'REFUSED' | 'HELD_FOR_STEPUP';

const TONE: Record<Outcome, { cls: string; word: string; sub: string }> = {
  CLEARED: { cls: 'text-seal-ink border-seal-ink', word: 'CLEARED', sub: 'Released for settlement' },
  REFUSED: { cls: 'text-stamp-ink border-stamp-ink', word: 'REFUSED', sub: 'Nothing is paid' },
  HELD_FOR_STEPUP: { cls: 'text-hold-ink border-hold-ink', word: 'HELD', sub: 'For a verified human' },
};

export function Stamp({ outcome, reason, press = false }: { outcome: Outcome; reason: string; press?: boolean }) {
  const t = TONE[outcome];
  return (
    <div
      role="img"
      aria-label={`Verdict: ${outcome}, reason ${reason}`}
      className={`stamp ${press ? 'stamp-press' : ''} inline-flex select-none flex-col items-center rounded-[4px] border-[3px] px-4 py-2 ${t.cls}`}
      style={{ boxShadow: 'inset 0 0 0 2px var(--manifest), inset 0 0 0 3px currentColor' }}
    >
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.3em]">Bonded · Inspected</span>
      <span className="font-sans text-3xl font-bold leading-tight tracking-[0.12em] sm:text-4xl">{t.word}</span>
      <span className="max-w-[16rem] break-all text-center font-mono text-[11px] font-semibold uppercase tracking-wider">{reason}</span>
      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.2em]">{t.sub}</span>
    </div>
  );
}
