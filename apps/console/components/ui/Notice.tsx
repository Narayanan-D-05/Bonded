import type { ReactNode } from 'react';

/**
 * A bordered notice on the dark canvas. `error` uses stamp-lit text (stamp itself is too dark for
 * small text on harbor), `ok` seal, `hold` hold, `info` the neutral tones. Errors are never
 * swallowed: pages render the error string they received, verbatim, inside one of these.
 */
export type Tone = 'error' | 'ok' | 'hold' | 'info';

const TONES: Record<Tone, { box: string; title: string }> = {
  error: { box: 'border-stamp/70 border-l-stamp bg-stamp/10', title: 'text-stamp-lit' },
  ok: { box: 'border-seal/50 border-l-seal bg-seal/10', title: 'text-seal' },
  hold: { box: 'border-hold/50 border-l-hold bg-hold/10', title: 'text-hold' },
  info: { box: 'border-hairline border-l-fog bg-deepwater', title: 'text-manifest' },
};

export function Notice({
  tone,
  title,
  children,
  role,
  className = '',
}: {
  tone: Tone;
  title?: ReactNode;
  children?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div role={role} className={`rounded-doc border border-l-4 px-4 py-3 text-sm leading-relaxed ${t.box} ${className}`}>
      {title && <div className={`mb-0.5 font-semibold ${t.title}`}>{title}</div>}
      {children && <div className="break-words text-manifest/90">{children}</div>}
    </div>
  );
}
