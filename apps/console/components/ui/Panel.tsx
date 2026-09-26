import type { ReactNode } from 'react';

/** A deepwater panel with a mono, uppercase label, like one section of a port-authority form. */
export function Panel({
  label,
  aside,
  children,
  className = '',
}: {
  label?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-doc border border-hairline bg-deepwater ${className}`}>
      {label && (
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 py-2.5 sm:px-5">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-fog">{label}</h2>
          {aside && <div className="text-xs text-fog">{aside}</div>}
        </header>
      )}
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

/** A label/value row inside a `<dl>`. Values wrap (break-all for mono) so hashes never widen the page. */
export function Field({ label, children, mono = true }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-hairline/70 py-2 last:border-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs uppercase tracking-wider text-fog">{label}</dt>
      <dd className={`min-w-0 text-sm text-manifest ${mono ? 'break-all font-mono' : 'break-words'}`}>{children}</dd>
    </div>
  );
}
