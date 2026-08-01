'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppBar from '@/components/AppBar';
import { formatDuration, getSyncCode } from '@/lib/session';

type Essay = {
  id: string;
  topicId: number;
  statement: string;
  wordCount: number;
  secondsUsed: number;
  saved: boolean;
  createdAt: string;
  scores: { holistic: number } | null;
};

export default function SavedPage() {
  const [essays, setEssays] = useState<Essay[] | null>(null);
  const [onlySaved, setOnlySaved] = useState(true);

  useEffect(() => {
    fetch(`/api/essays?syncCode=${encodeURIComponent(getSyncCode())}`)
      .then((r) => r.json())
      .then((data) => setEssays(data.essays ?? []))
      .catch(() => setEssays([]));
  }, []);

  const shown = (essays ?? []).filter((essay) => !onlySaved || essay.saved);

  return (
    <>
      <AppBar
        contextTitle="Saved issues"
        actions={
          <>
            <Link href="/" className="gre-btn">
              Home
            </Link>
            <Link href="/write" className="gre-btn gre-btn-primary">
              Start a new issue
            </Link>
          </>
        }
      />

      <div className="gre-page">
        <div className="gre-row" style={{ marginBottom: '1.25rem' }}>
          <button className="gre-chip" aria-pressed={onlySaved} onClick={() => setOnlySaved(true)}>
            Saved
          </button>
          <button className="gre-chip" aria-pressed={!onlySaved} onClick={() => setOnlySaved(false)}>
            All attempts
          </button>
        </div>

        {!essays && <p className="gre-muted">Loading...</p>}

        {essays && shown.length === 0 && (
          <p className="gre-muted">
            {onlySaved
              ? 'Nothing saved yet. Press "Save for later" on a result to keep it here.'
              : 'No attempts yet.'}
          </p>
        )}

        {shown.length > 0 && (
          <div className="gre-scroll-x">
            <table className="gre-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Prompt</th>
                  <th>Grade</th>
                  <th>Words</th>
                  <th>Time</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((essay) => (
                  <tr key={essay.id}>
                    <td>{essay.createdAt?.slice(0, 10)}</td>
                    <td>
                      {essay.statement.slice(0, 80)}
                      {essay.statement.length > 80 ? '...' : ''}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                      {essay.scores ? essay.scores.holistic.toFixed(1) : '--'}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{essay.wordCount}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatDuration(essay.secondsUsed)}
                    </td>
                    <td>
                      <Link href={`/result/${essay.id}`} className="gre-btn-light" style={{ textDecoration: 'none' }}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
