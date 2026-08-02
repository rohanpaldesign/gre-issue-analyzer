'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppBar from '@/components/AppBar';
import { getSyncCode } from '@/lib/session';

type TrendPoint = { holistic: number; date: string };

type Summary = {
  trend: TrendPoint[];
  revisionGain: number | null;
  revisionCount: number;
  displayName: string | null;
  testDate: string | null;
  expectedGrade: number | null;
  attempted: number;
  total: number;
  weakest: Array<{ key: string; label: string; mean: number; advice: string }>;
  essayCount: number;
};

export default function HomePage() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    fetch(`/api/summary?syncCode=${encodeURIComponent(getSyncCode())}`)
      .then((r) => r.json())
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  const daysToTest = summary?.testDate ? daysUntil(summary.testDate) : null;

  return (
    <>
      <AppBar
        contextTitle={summary?.displayName ? `Welcome ${summary.displayName}` : 'Welcome'}
        actions={
          <Link href="/account" className="gre-btn">
            Account
          </Link>
        }
      />

      <div className="gre-page">
        <div className="gre-stats">
          <div>
            <div className="gre-stat-label">Expected grade</div>
            <div className="gre-stat-value">
              {summary?.expectedGrade != null ? summary.expectedGrade.toFixed(1) : '--'}
            </div>
            {summary != null && summary.essayCount > 0 && summary.essayCount < 3 && (
              <div className="gre-tiny gre-muted" style={{ marginTop: '0.4rem' }}>
                From {summary.essayCount} essay{summary.essayCount === 1 ? '' : 's'}, so treat it as a
                rough first reading
              </div>
            )}
          </div>

          <div>
            <div className="gre-stat-label">Days to test</div>
            <div className="gre-stat-value">
              {daysToTest == null ? 'Not set' : daysToTest < 0 ? 'Passed' : `${daysToTest} days`}
            </div>
            {daysToTest == null && (
              <div className="gre-tiny gre-muted" style={{ marginTop: '0.4rem' }}>
                <Link href="/account">Set your test date</Link>
              </div>
            )}
          </div>

          <div>
            <div className="gre-stat-label">Issue topics completed</div>
            <div className="gre-stat-value">
              {summary?.attempted ?? 0} / {summary?.total ?? 159}
            </div>
          </div>
        </div>

        <div className="gre-columns">
          <section>
            <h2 className="gre-col-title">Practice issue writing</h2>
            <div className="gre-row">
              <Link href="/write" className="gre-btn">
                Start a new issue
              </Link>
              <Link href="/saved" className="gre-btn gre-btn-primary">
                View saved issues
              </Link>
            </div>
            <p className="gre-small gre-muted" style={{ marginTop: '1rem' }}>
              Thirty minutes, one prompt from the official pool of {summary?.total ?? 159}. You can
              also browse <Link href="/topics">every topic</Link>.
            </p>
          </section>

          <section>
            <h2 className="gre-col-title">Areas to improve</h2>
            {!summary || summary.essayCount === 0 ? (
              <p className="gre-small gre-muted">
                Write your first essay and the traits holding your score back will appear here.
              </p>
            ) : (
              summary.weakest.map((trait) => (
                <div key={trait.key} className="gre-improve-item">
                  <div style={{ fontWeight: 700 }}>
                    {trait.label}{' '}
                    <span className="gre-muted" style={{ fontWeight: 400 }}>
                      averaging {trait.mean.toFixed(1)} of 6
                    </span>
                  </div>
                  <div className="gre-small gre-muted">{trait.advice}</div>
                </div>
              ))
            )}
          </section>
        </div>

        {summary && summary.trend.length > 0 && (
          <section className="gre-panel">
            <h2 className="gre-col-title">Score over time</h2>
            <Sparkline points={summary.trend} />
            <p className="gre-small gre-muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              {summary.trend.length} first attempt{summary.trend.length === 1 ? '' : 's'}, oldest to
              newest. Revisions are left out so the line cannot rise just from reworking one essay.
              {summary.revisionCount > 0 && summary.revisionGain !== null && (
                <>
                  {' '}
                  Across {summary.revisionCount} revision{summary.revisionCount === 1 ? '' : 's'} your
                  score changed by {summary.revisionGain >= 0 ? '+' : ''}
                  {summary.revisionGain.toFixed(1)} on average.
                </>
              )}
            </p>
          </section>
        )}
      </div>
    </>
  );
}

/** Score history, drawn inline so the dashboard carries no chart dependency. */
function Sparkline({ points }: { points: TrendPoint[] }) {
  const width = 640;
  const height = 150;
  const pad = 12;
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const y = (value: number) => height - pad - ((value - 1) / 5) * (height - pad * 2);
  const path = points.map((point, i) => `${pad + i * step},${y(point.holistic)}`).join(' ');

  return (
    <div className="gre-scroll-x">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Score trend across ${points.length} first attempts`}
      >
        {[1, 2, 3, 4, 5, 6].map((mark) => (
          <g key={mark}>
            <line
              x1={pad}
              x2={width - pad}
              y1={y(mark)}
              y2={y(mark)}
              stroke="var(--rule-soft)"
              strokeWidth="1"
            />
            <text x={0} y={y(mark) + 4} fontSize="11" fill="var(--ink-faint)">
              {mark}
            </text>
          </g>
        ))}
        {points.length > 1 && (
          <polyline points={path} fill="none" stroke="var(--btn-blue-bottom)" strokeWidth="2.5" />
        )}
        {points.map((point, i) => (
          <circle key={i} cx={pad + i * step} cy={y(point.holistic)} r="4" fill="var(--btn-blue-bottom)" />
        ))}
      </svg>
    </div>
  );
}

function daysUntil(isoDate: string): number {
  const target = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}
