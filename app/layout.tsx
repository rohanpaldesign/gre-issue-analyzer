import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GRE Issue Analyzer',
  description:
    'Practice the GRE Analyze an Issue task against real ETS prompts, with rubric-calibrated scoring, model responses for both sides, and progress tracking.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
