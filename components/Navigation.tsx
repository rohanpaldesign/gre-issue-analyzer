'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Write', icon: '✎' },
  { href: '/topics', label: 'Topics', icon: '☰' },
  { href: '/progress', label: 'Progress', icon: '↗' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
];

/**
 * One set of links rendered three times.
 *
 * Which one is visible is decided entirely by CSS media queries, so there is no
 * viewport measurement in JavaScript and no flash of the wrong navigation
 * before hydration.
 */
export default function Navigation() {
  const pathname = usePathname();
  const isCurrent = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  const links = ITEMS.map((item) => (
    <Link
      key={item.href}
      href={item.href}
      className="lp-nav-item"
      aria-current={isCurrent(item.href) ? 'page' : undefined}
    >
      <span className="lp-nav-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span>{item.label}</span>
    </Link>
  ));

  return (
    <>
      <nav className="lp-nav-drawer" aria-label="Main">
        <h1 style={{ fontSize: '1.05rem', padding: '0 1rem 1rem' }}>GRE Issue Analyzer</h1>
        {links}
      </nav>
      <nav className="lp-nav-rail" aria-label="Main">
        {links}
      </nav>
      <nav className="lp-nav-bar" aria-label="Main">
        {links}
      </nav>
    </>
  );
}
