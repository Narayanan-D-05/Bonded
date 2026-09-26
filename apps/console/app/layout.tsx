import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bonded Console',
  description:
    'AP/BEC invoice enforcement demo — re-derives the facts a payment decision relies on, independently, right before money moves.',
};

/**
 * Minimal root layout — a hackathon demo screen, not a design pass. Plain, legible chrome
 * only. Deliberately does not touch `app/deck/page.tsx` (a separate, gitignored, full-bleed
 * sibling route with no nav chrome of its own — see that file's own comment).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased">
        <header className="border-b border-slate-200 px-6 py-4">
          <a href="/invoices" className="text-lg font-semibold">
            Bonded Console
          </a>
          <span className="ml-3 text-sm text-slate-500">AP / BEC invoice enforcement demo</span>
          <a href="/vendor/bank-change" className="ml-6 text-sm text-blue-600 hover:underline">
            Vendor portal
          </a>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
