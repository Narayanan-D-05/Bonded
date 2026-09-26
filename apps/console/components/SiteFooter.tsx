import Image from 'next/image';
import { SponsorLogo, sponsorName, type Sponsor } from './ui/SponsorLogo';

/** What each sponsor does in Bonded (from sponsers.md). */
const SPONSORS: readonly { id: Sponsor; line: string }[] = [
  { id: 'intercepta', line: 'Live risk screening of every payee before money moves.' },
  { id: 'world', line: 'Verified humans approve bank changes and large payments (World ID and IDKit).' },
  { id: 'sui', line: 'Holds the funds and settles each payment exactly once, on-chain.' },
];

/**
 * The footer: a "powered by" showcase of the three sponsors (large logos, name, one line each), then the wordmark section after bondedfi.vercel.app, the
 * project's /media/end.png globe (referenced, never copied) behind a large faded "BONDED".
 * Navigation lives in the top nav.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-rule bg-white">
      <section aria-label="Powered by" className="mx-auto max-w-content px-4 pb-4 pt-16 sm:px-6 sm:pt-20">
        <ul className="grid gap-6 md:grid-cols-3">
          {SPONSORS.map((sp) => (
            <li key={sp.id} className="box box-lift flex flex-col items-center px-8 py-10 text-center">
              <SponsorLogo sponsor={sp.id} size={112} />
              <h2 className="mt-6 font-display text-3xl font-bold tracking-[-0.02em] text-navy">{sponsorName(sp.id)}</h2>
              <p className="mt-3 max-w-xs text-base leading-relaxed text-muted">{sp.line}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="relative flex min-h-[440px] w-full flex-col justify-end overflow-hidden bg-white md:min-h-[72vh]">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[74%] opacity-[0.55]" aria-hidden="true">
          <Image src="/media/end.png" alt="" fill sizes="100vw" className="glyph-art-light object-contain object-center" />
        </div>
        <div className="pointer-events-none relative z-10 w-full select-none overflow-hidden" aria-hidden="true">
          <span
            className="block whitespace-nowrap text-center font-display text-[17vw] font-bold uppercase leading-[0.8] tracking-[-0.04em]"
            style={{
              backgroundImage: 'linear-gradient(to bottom, rgba(16,49,74,0.17) 0%, rgba(16,49,74,0.075) 48%, rgba(16,49,74,0) 90%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            BONDED
          </span>
        </div>
      </div>
    </footer>
  );
}
