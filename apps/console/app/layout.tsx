import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import { SiteFooter } from '../components/SiteFooter';
import { SiteNav } from '../components/SiteNav';
import './globals.css';

// next/font/google (bundled docs: 03-api-reference/02-components/font.md): downloaded at build
// time and self-hosted; `variable` exposes each as a CSS variable the Tailwind font stacks read.
const sans = Instrument_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Bonded: payments that re-check the facts',
  description:
    'Bonded re-derives the facts an AP agent’s payment relies on, right before money moves: CLEARED pays on Sui, a bank change waits for a World ID-verified human, fraud is refused.',
};

export const viewport: Viewport = {
  themeColor: '#0B1A22',
};

/**
 * Root layout: nav, page, footer. `app/deck/page.tsx`, when present locally, is a gitignored
 * sibling route; nothing here imports it or its components.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col bg-harbor font-sans text-manifest antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-control focus:bg-manifest focus:px-3 focus:py-2 focus:text-ink"
        >
          Skip to content
        </a>
        <SiteNav />
        <main id="main" className="mx-auto w-full max-w-content flex-1 px-4 py-10 sm:px-6 sm:py-14">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
