import Image from 'next/image';
import { SponsorLogo, sponsorName, type Sponsor } from './ui/SponsorLogo';

const SPONSORS: readonly Sponsor[] = ['intercepta', 'world', 'sui'];

/**
 * The footer: a light-blue "Built with" band where the three sponsor logos sit in one even,
 * centred row, then the wordmark section after bondedfi.vercel.app: the project's
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
          {SPONSORS.map((id) => (
            <li
              key={id}
              className="group flex flex-col items-center gap-2 opacity-45 grayscale transition duration-300 hover:opacity-100 hover:grayscale-0"
            >
              <SponsorLogo sponsor={id} size={52} alt={sponsorName(id)} />
              <span className="text-sm font-semibold text-[#0B1B33]">{sponsorName(id)}</span>
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
