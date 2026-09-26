import type { ReactNode } from 'react';

/**
 * A bordered notice. Notices carry state, so they use the reserved verdict hues, never the
 * Intercepta box orange: `error` refused crimson, `ok` cleared green, `hold` held yellow, `info` a
 * Sui-blue edge. The body is black, so every state colour sits on black. Errors are never
 * swallowed: pages render the error string they received, verbatim, inside one of these.
 */
export type Tone = 'error' | 'ok' | 'hold' | 'info';

const TONES: Record<Tone, { box: string; title: string }> = {
  error: { box: 'border-refused/60 border-l-refused', title: 'text-refused' },
  ok: { box: 'border-cleared/50 border-l-cleared', title: 'text-cleared' },
  hold: { box: 'border-held/50 border-l-held', title: 'text-held' },
  info: { box: 'border-sui/40 border-l-sui', title: 'text-navy' },
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
    <div role={role} className={`rounded-xl border border-l-4 bg-white px-4 py-3 text-sm leading-relaxed ${t.box} ${className}`}>
      {title && <div className={`mb-0.5 font-semibold ${t.title}`}>{title}</div>}
      {children && <div className="break-words text-navy/90">{children}</div>}
    </div>
  );
}
