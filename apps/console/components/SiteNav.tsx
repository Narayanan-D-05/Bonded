'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import bondedLogo from '../app/main_logo/bonded_logo.png';

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

/** Top navigation: the Bonded wordmark, the four sections, and the network badge. */
export function SiteNav() {
  const pathname = usePathname() ?? '/';
  return (
    <header className="border-b border-hairline bg-harbor/95">
      <div className="mx-auto flex max-w-content flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Bonded, overview">
          <LogoMark />
          <span className="text-lg font-semibold tracking-tight text-manifest">Bonded</span>
        </Link>
        <span className="order-2 ml-auto inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-fog sm:order-3">
          <span className="h-1.5 w-1.5 rounded-full bg-seal" aria-hidden="true" />
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
                    className={`block rounded-control px-2.5 py-1.5 text-sm transition-colors ${
                      active ? 'bg-deepwater text-manifest' : 'text-fog hover:text-manifest'
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
