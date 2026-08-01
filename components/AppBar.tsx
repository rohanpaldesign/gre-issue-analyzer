'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The two fixed bars every screen carries: the dark application bar with the
 * wordmark and actions, and the pink context strip beneath it.
 *
 * Actions are passed in rather than derived from the route, because what
 * belongs there differs per screen (Submit while writing, Save for later on a
 * result, Account on the dashboard).
 */
export default function AppBar({
  contextTitle,
  actions,
  contextRight,
}: {
  contextTitle: string;
  actions?: ReactNode;
  contextRight?: ReactNode;
}) {
  return (
    <>
      <header className="gre-appbar">
        <Link href="/" className="gre-wordmark">
          GRE Issue Analyzer
        </Link>
        <div className="gre-appbar-actions">{actions}</div>
      </header>
      <div className="gre-context">
        <div className="gre-context-title">{contextTitle}</div>
        <div className="gre-context-right">{contextRight}</div>
      </div>
    </>
  );
}
