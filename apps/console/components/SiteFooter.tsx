import Image from 'next/image';
import Link from 'next/link';
import bondedLogo from '../app/main_logo/bonded_logo.png';
import { SponsorTag, type Sponsor } from './ui/SponsorLogo';

/** The repository this console is built from (git remote `origin`). */
const REPO_URL = 'https://github.com/Narayanan-D-05/Bonded';

const PRODUCT = [
  { href: '/', label: 'Overview' },
  { href: '/invoices', label: 'Invoice Inbox' },
  { href: '/vendor/bank-change', label: 'Vendor portal' },
  { href: '/activity', label: 'Activity' },
] as const;

const DOCS = [
  { path: 'README.md', label: 'README' },
  { path: 'USECASE.md', label: 'Use case' },
  { path: 'docs/THREATMODEL.md', label: 'Threat model' },
  { path: 'sponsers.md', label: 'Sponsor notes' },
] as const;

const BUILT_WITH: Sponsor[] = ['intercepta', 'world', 'sui'];

export function SiteFooter() {
  return (
    <footer className="border-t border-rule bg-white">
      <div className="mx-auto grid max-w-content gap-10 px-4 py-14 text-sm text-muted sm:px-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="flex items-center gap-2.5">
            <Image src={bondedLogo} alt="" width={28} height={28} className="h-7 w-7 rounded-md" />
            <span className="font-display text-xl font-bold tracking-[-0.02em] text-navy">Bonded</span>
          </div>
          <p className="mt-4 max-w-md leading-relaxed">
            Bonded re-derives the facts a payment relies on, right before money moves. The vendor master is a disclosed, controlled fixture
            standing in for a real issuer or accounting API (or a live Xero org when configured); see the threat model.
          </p>
        </div>
        <nav aria-label="Product">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-sui">Product</h2>
          <ul className="mt-4 space-y-2">
            {PRODUCT.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-navy/90 underline-offset-4 hover:text-sui hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Repository docs">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-sui">Docs</h2>
          <ul className="mt-4 space-y-2">
            {DOCS.map((d) => (
              <li key={d.path}>
                <a
                  href={`${REPO_URL}/blob/main/${d.path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-navy/90 underline-offset-4 hover:text-sui hover:underline"
                >
                  {d.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-rule bg-ocean-900">
        <div className="mx-auto flex max-w-content flex-wrap items-center gap-x-6 gap-y-3 px-4 py-5 sm:px-6">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Built with</span>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Built with">
            {BUILT_WITH.map((s) => (
              <li key={s}>
                <SponsorTag sponsor={s} size={20} className="text-sm font-semibold text-navy" />
              </li>
            ))}
          </ul>
        </div>
      </div>
      {/* The wordmark section, after bondedfi.vercel.app: the project's /media/end.png globe (referenced, never
          copied) behind a large faded "bonded". Decorative only. */}
      <div className="relative flex min-h-[440px] w-full flex-col justify-end overflow-hidden bg-white md:min-h-[72vh]">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[74%] opacity-[0.55]" aria-hidden="true">
          <Image src="/media/end.png" alt="" fill sizes="100vw" className="glyph-art-light object-contain object-center" />
        </div>
        <div className="pointer-events-none relative z-10 w-full select-none overflow-hidden" aria-hidden="true">
          <span
            className="block whitespace-nowrap text-center font-display text-[23vw] font-bold lowercase leading-[0.78] tracking-[-0.055em]"
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
