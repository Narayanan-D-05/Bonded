'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import bondedLogo from '../app/main_logo/bonded_logo.png';
import { SponsorLogo } from './ui/SponsorLogo';

const LINKS = [
  { href: '/', label: 'Overview', match: (p: string) => p === '/' },
  { href: '/invoices', label: 'Invoice Inbox', match: (p: string) => p.startsWith('/invoices') || p.startsWith('/stepup') },
  { href: '/vendor/bank-change', label: 'Vendor portal', match: (p: string) => p.startsWith('/vendor') },
  { href: '/activity', label: 'Activity', match: (p: string) => p.startsWith('/activity') },
] as const;

/** The project logo (app/main_logo/bonded_logo.png), served resized by next/image. */
function LogoMark() {
  return <Image src={bondedLogo} alt="" width={28} height={28} priority className="h-7 w-7 shrink-0 rounded-md" />;
}

/** Top navigation on a black bar: the Bonded wordmark, the four sections (active in Sui blue), and the Sui network badge. */
export function SiteNav() {
  const pathname = usePathname() ?? '/';
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex max-w-content flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-12">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Bonded, overview">
          <LogoMark />
          <span className="font-display text-xl font-bold tracking-[-0.02em] text-navy">Bonded</span>
        </Link>
        <span className="order-2 ml-auto inline-flex items-center gap-1.5 rounded-full border border-sui/40 bg-ocean-800 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-sui sm:order-3">
          <SponsorLogo sponsor="sui" size={16} />
          Sui testnet
        </span>
        <nav aria-label="Primary" className="order-3 w-full sm:order-2 sm:w-auto">
          <ul className="flex flex-wrap gap-x-1 gap-y-1">
            {LINKS.map((l) => {
              const active = l.match(pathname);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
                      active ? 'bg-sui text-white' : 'text-muted hover:bg-ocean-800 hover:text-navy'
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
