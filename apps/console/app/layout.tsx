import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Bricolage_Grotesque, Instrument_Sans, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import { ConsoleFrame } from '../components/ConsoleFrame';
import { SiteFooter } from '../components/SiteFooter';
import { SiteNav } from '../components/SiteNav';
import './globals.css';

// next/font/google (bundled docs: 03-api-reference/02-components/font.md): downloaded at build
// time and self-hosted; `variable` exposes each as a CSS variable the Tailwind font stacks read.
const sans = Instrument_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-mono' });
// Console headings: Bricolage Grotesque (variable; its optical-size axis tightens large titles),
// with Instrument Serif italic for one emphasised phrase per hero. Only `.console` pages use them.
const display = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap', variable: '--font-display', axes: ['opsz'] });
const accent = Instrument_Serif({ subsets: ['latin'], weight: '400', style: 'italic', display: 'swap', variable: '--font-accent' });

export const metadata: Metadata = {
  title: 'Bonded: payments that re-check the facts',
  description:
    'Bonded re-derives the facts an AP agent’s payment relies on, right before money moves: CLEARED pays on Sui, a bank change waits for a World ID-verified human, fraud is refused.',
};

export const viewport: Viewport = {
  themeColor: '#0B1A22',
};

/**
 * Root layout: nav, page, footer, inside ConsoleFrame (the `.console` theme scope on every route
 * except /deck). `app/deck/page.tsx`, when present locally, is a gitignored sibling route; nothing
 * here imports it or its components, and its styles are untouched.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable} ${accent.variable}`}>
      <body className="flex min-h-screen flex-col bg-harbor font-sans text-manifest antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-control focus:bg-manifest focus:px-3 focus:py-2 focus:text-ink"
        >
          Skip to content
        </a>
        <ConsoleFrame>
          <SiteNav />
          <main id="main" className="w-full flex-1">
            {children}
          </main>
          <SiteFooter />
        </ConsoleFrame>
      </body>
    </html>
  );
}
