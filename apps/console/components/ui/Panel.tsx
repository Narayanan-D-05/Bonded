import type { ReactNode } from 'react';
import { SponsorLogo, type Sponsor } from './SponsorLogo';

/**
 * A box (`.box` in globals.css): 2px Intercepta-orange frame, 16px radius, white body, soft
 * shadow and glow, and a solid orange header strip with black text (~6.4:1). `sponsor` puts that
 * sponsor's mark, on a small black disc so it reads on the orange, before the label; it is used
 * only where that sponsor's technology is at work. `aside` sits in a black pill on the strip, so
 * any verdict colour inside it stays on black.
 */
export function Panel({
  label,
  aside,
  sponsor,
  children,
  className = '',
  bodyClassName = 'px-5 py-5 sm:px-6',
  as: Tag = 'section',
}: {
  label: ReactNode;
  aside?: ReactNode | undefined;
  sponsor?: Sponsor | undefined;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'article' | 'div' | 'li' | 'figure';
}) {
  return (
    <Tag className={`box ${className}`}>
      <header className="box-head flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 sm:px-6">
        <h2 className="flex min-w-0 items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.16em] text-navy">
          {sponsor && (
            <span className="inline-flex shrink-0 rounded-full bg-white p-1 ring-1 ring-rule">
              <SponsorLogo sponsor={sponsor} size={18} />
            </span>
          )}
          <span className="min-w-0 break-words">{label}</span>
        </h2>
        {aside && <div className="rounded-full bg-white px-3 py-0.5 text-xs font-medium text-muted">{aside}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </Tag>
  );
}

/** A label/value row inside a `<dl>`. Values wrap (break-all for mono) so hashes never widen the page. */
export function Field({ label, children, mono = true }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-rule py-2.5 last:border-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className={`min-w-0 text-sm text-navy ${mono ? 'break-all font-mono' : 'break-words'}`}>{children}</dd>
    </div>
  );
}

/** A figure in a box: orange strip label, then the value large. `tone` colours the value. */
export function Stat({
  label,
  value,
  sponsor,
  tone = 'sui',
  note,
}: {
  label: ReactNode;
  value: ReactNode;
  sponsor?: Sponsor | undefined;
  tone?: 'sui' | 'snow' | 'cleared' | 'held' | 'refused';
  note?: ReactNode | undefined;
}) {
  const color = { sui: 'text-sui', snow: 'text-navy', cleared: 'text-cleared', held: 'text-held', refused: 'text-refused' }[tone];
  return (
    <Panel label={label} sponsor={sponsor} as="div" bodyClassName="px-5 py-5 sm:px-6">
      <div className={`break-words font-mono text-3xl font-semibold tracking-tight sm:text-4xl ${color}`}>{value}</div>
      {note && <div className="mt-2 text-sm leading-relaxed text-muted">{note}</div>}
    </Panel>
  );
}
