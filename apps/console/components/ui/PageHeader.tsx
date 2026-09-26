import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Page structure for the console theme: full-bleed section bands in alternating Sui-blue shades
 * (`bg-hero`, `bg-band`, `bg-deep`, `bg-cta` in globals.css), a max-width container, the orange
 * eyebrow, and Bricolage Grotesque display headings.
 */
export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-content px-4 sm:px-6 ${className}`}>{children}</div>;
}

/** Small uppercase label above a title: a solid orange bar, then soft-orange text (>= 5.3:1 on blue). */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`flex items-center gap-2.5 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-sui ${className}`}>
      <span className="h-[3px] w-6 shrink-0 rounded-full bg-sui-brand" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** A serif-italic accent for one emphasised word or phrase in a headline. */
export function Accent({ children }: { children: ReactNode }) {
  return <em className="font-accent font-normal italic tracking-normal">{children}</em>;
}

type Tone = 'hero' | 'band' | 'deep' | 'cta';
const TONE: Record<Tone, string> = { hero: 'bg-hero', band: 'bg-band', deep: 'bg-deep', cta: 'bg-cta' };

/** A full-bleed section band with an optional eyebrow, display title and lede. */
export function Section({
  id,
  tone = 'deep',
  eyebrow,
  title,
  lede,
  children,
  className = '',
}: {
  id?: string;
  tone?: Tone;
  eyebrow?: ReactNode;
  title?: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={title ? headingId : undefined} className={`${TONE[tone]} py-16 sm:py-20 lg:py-24 ${className}`}>
      <Container>
        {(eyebrow || title || lede) && (
          <div className="mb-10 max-w-3xl sm:mb-12">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            {title && (
              <h2 id={headingId} className="mt-4 font-display text-3xl font-bold leading-[1.1] tracking-[-0.02em] text-navy sm:text-4xl lg:text-5xl">
                {title}
              </h2>
            )}
            {lede && <div className="mt-4 text-base leading-relaxed text-muted sm:text-lg">{lede}</div>}
          </div>
        )}
        {children}
      </Container>
    </section>
  );
}

/** The top of every page: gradient hero band, back link, eyebrow, display H1, lede, and extras. */
export function PageHero({
  eyebrow,
  title,
  lede,
  back,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  back?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <section className="bg-hero pb-16 pt-12 sm:pb-20 sm:pt-16 lg:pb-24">
      <Container>
        {back && (
          <Link href={back.href} className="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-sui underline-offset-4 hover:text-navy hover:underline">
            <span aria-hidden="true">←</span>
            {back.label}
          </Link>
        )}
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-5 max-w-4xl break-words font-display text-4xl font-bold leading-[1.05] tracking-[-0.03em] text-navy sm:text-5xl lg:text-6xl">
          {title}
        </h1>
        {lede && <div className="mt-5 max-w-3xl text-base leading-relaxed text-muted sm:text-lg">{lede}</div>}
        {children}
      </Container>
    </section>
  );
}
