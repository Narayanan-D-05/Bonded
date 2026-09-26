import Link from 'next/link';
import type { ReactNode } from 'react';

/** Page title block: a mono kicker (the "form number"), the title, and a short lede. */
export function PageHeader({
  kicker,
  title,
  lede,
  back,
  children,
}: {
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
  back?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <header className="mb-8">
      {back && (
        <Link href={back.href} className="mb-5 inline-block text-sm text-fog underline-offset-2 hover:text-manifest hover:underline">
          <span aria-hidden="true">← </span>
          {back.label}
        </Link>
      )}
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-fog">{kicker}</p>
      <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight text-manifest sm:text-4xl">{title}</h1>
      {lede && <div className="mt-3 max-w-3xl text-base leading-relaxed text-fog">{lede}</div>}
      {children}
    </header>
  );
}
