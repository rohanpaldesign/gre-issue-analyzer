import type { Metadata, Viewport } from 'next';
import './globals.css';
import Navigation from '@/components/Navigation';

export const metadata: Metadata = {
  title: 'GRE Issue Analyzer',
  description:
    'Practice the GRE Analyze an Issue task against real ETS prompts, with rubric-calibrated scoring, both sides of every argument, and progress tracking.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The composer needs the full viewport height on mobile.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="lp-shell">
          <Navigation />
          <main className="lp-main">
            <div className="lp-content">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
