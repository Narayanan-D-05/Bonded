import Image from 'next/image';
import { SponsorLogo, sponsorName, type Sponsor } from './ui/SponsorLogo';

/** Each sponsor floats at its own height and pace, so the row reads as a loose, moving constellation. */
const SPONSORS: readonly { id: Sponsor; lift: number; delay: string }[] = [
  { id: 'intercepta', lift: 28, delay: '0s' },
  { id: 'world', lift: -18, delay: '-2.2s' },
  { id: 'sui', lift: 20, delay: '-4.1s' },
];

/**
 * The footer: a light-blue "Built with" band where the three sponsor logos float, spaced wide
 * and staggered, then the wordmark section after bondedfi.vercel.app: the project's
 * /media/end.png globe (referenced, never copied) laid out as a wide landscape band behind a
 * large, faded "bonded". Navigation lives in the top nav.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-rule bg-white">
      <section aria-label="Built with" className="bg-[#F4F9FF] px-4 sm:px-6" style={{ paddingTop: 64, paddingBottom: 72 }}>
        <p className="text-center font-mono text-sm tracking-wide text-[#1A63BF]/70">Built with: ETHGlobal Tokyo 2026</p>
        <ul
          className="mx-auto flex max-w-4xl flex-wrap items-center justify-center"
          style={{ columnGap: 'clamp(56px, 12vw, 160px)', rowGap: 48, marginTop: 56 }}
        >
          {SPONSORS.map(({ id, lift, delay }) => (
            <li key={id} className="flex flex-col items-center gap-3" style={{ transform: `translateY(${lift}px)` }}>
              <div className="sponsor-float" style={{ animationDelay: delay }}>
                <div className="rounded-3xl bg-white p-4 shadow-[0_18px_40px_-18px_rgba(26,99,191,0.45)] ring-1 ring-[#DCEBFF]">
                  <SponsorLogo sponsor={id} size={84} alt={sponsorName(id)} />
                </div>
              </div>
              <span className="text-base font-semibold text-[#0B1B33]">{sponsorName(id)}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="relative flex min-h-[380px] w-full flex-col justify-end overflow-hidden bg-white md:min-h-[62vh]">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[82%] opacity-[0.55]" aria-hidden="true">
          <Image src="/media/end.png" alt="" fill sizes="100vw" className="glyph-art-light object-cover object-[center_38%]" />
        </div>
        <div className="pointer-events-none relative z-10 w-full select-none overflow-hidden" aria-hidden="true">
          <span
            className="block font-sans font-bold lowercase leading-[0.78] text-center whitespace-nowrap text-[23vw] tracking-[-0.055em]"
            style={{
              backgroundImage: 'linear-gradient(to bottom, rgba(16,49,74,0.17) 0%, rgba(16,49,74,0.075) 48%, rgba(16,49,74,0) 90%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            bonded
          </span>
        </div>
      </div>
    </footer>
  );
}
