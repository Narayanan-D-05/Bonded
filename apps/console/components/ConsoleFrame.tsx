'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The console theme's scope. Every route except /deck renders inside `.console` (blue canvas,
 * orange boxes, macOS-style cursor; see the CONSOLE THEME block in app/globals.css). /deck keeps
 * exactly the wrapper it had before (a plain flex column), so none of those styles reach it.
 */
export function ConsoleFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const deck = pathname === '/deck' || pathname.startsWith('/deck/');
  return <div className={deck ? 'flex min-h-screen flex-col' : 'console flex min-h-screen flex-col font-sans'}>{children}</div>;
}
