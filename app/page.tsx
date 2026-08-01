'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppBar from '@/components/AppBar';
import { getSyncCode } from '@/lib/session';

type Summary = {
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
      </div>
    </>
  );
}

function daysUntil(isoDate: string): number {
  const target = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}
