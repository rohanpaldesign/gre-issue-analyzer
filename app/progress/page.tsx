'use client';

import { useEffect, useState } from 'react';
import { formatDuration, getSyncCode } from '@/lib/session';

type Essay = {
  id: string;
  topicId: number;
  statement: string;
  taskType: string;
  wordCount: number;
  secondsUsed: number;
  timed: boolean;
  assisted: boolean;
  createdAt: string;
  scores: {
    holistic: number;
    position: number;
    development: number;
    organization: number;
    language: number;
    conventions: number;
  } | null;
};

const TRAITS = [
  ['position', 'Position'],
  ['development', 'Development'],
  ['organization', 'Organisation'],
  ['language', 'Language'],
  ['conventions', 'Conventions'],
] as const;

export default function ProgressPage() {
  const [essays, setEssays] = useState<Essay[] | null>(null);
  const [coverage, setCoverage] = useState<{ attempted: number; total: number } | null>(null);

  useEffect(() => {
    fetch(`/api/essays?syncCode=${encodeURIComponent(getSyncCode())}`)
      .then((r) => r.json())
      .then((data) => {
        setEssays(data.essays ?? []);
        setCoverage(data.coverage ?? null);
      })
      .catch(() => setEssays([]));
  }, []);

  if (!essays) return <p className="lp-muted">Loading your history...</p>;

  if (essays.length === 0) {
    return (
      <div className="lp-card">
        <h1>No essays yet</h1>
        <p className="lp-muted" style={{ marginBottom: 0 }}>
          Write one and it will show up here, along with your score trend and which traits are holding
          you back.
        </p>
      </div>
    );
  }

  // Assisted attempts are excluded: you read the arguments first, so the score
  // does not measure what you can do unaided.
  const counted = essays.filter((e) => !e.assisted && e.scores);
  const scored = [...counted].reverse();
  const trend = scored.map((e) => e.scores!.holistic);

  const recent = trend.slice(-5);
  const average = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const slope = trendSlope(trend);
  const predicted = Math.min(6, Math.max(1, average + slope * 2));

  const weakest = TRAITS.map(([key, label]) => ({
    key,
    label,
    mean:
      counted.length > 0
        ? counted.reduce((sum, e) => sum + (e.scores as Record<string, number>)[key], 0) / counted.length
        : 0,
  })).sort((a, b) => a.mean - b.mean)[0];

  const timedCount = counted.filter((e) => e.timed).length;

  return (
    <div className="lp-stack">
      <h1>Progress</h1>

      <div className="lp-grid-2">
        <section className="lp-card">
          <div className="lp-tiny lp-muted">Predicted Analytical Writing score</div>
          <div className="lp-band">
            <span className="lp-band-value">
              {round(predicted - 0.5)} to {round(predicted + 0.5)}
            </span>
          </div>
          <p className="lp-tiny lp-muted" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
            From your last {recent.length} unassisted essay{recent.length === 1 ? '' : 's'}
            {trend.length >= 3 && (
              <>
                {' '}
                and a trend of {slope >= 0 ? '+' : ''}
                {slope.toFixed(2)} per essay
              </>
            )}
            . On {counted.length} essay{counted.length === 1 ? '' : 's'} this is indicative, not reliable.
          </p>
        </section>

        <section className="lp-card">
          <div className="lp-tiny lp-muted">Weakest trait</div>
          {weakest && (
            <>
              <h2 style={{ marginTop: '0.35rem' }}>{weakest.label}</h2>
              <p className="lp-small lp-muted" style={{ marginBottom: 0 }}>
                Averaging {weakest.mean.toFixed(1)} out of 6. {adviceFor(weakest.key)}
              </p>
            </>
          )}
        </section>
      </div>

      {trend.length >= 2 && (
        <section className="lp-card">
          <h2>Score over time</h2>
          <Sparkline values={trend} />
          <div className="lp-tiny lp-muted">
            Oldest to newest, {trend.length} unassisted essays. Range 1 to 6.
          </div>
        </section>
      )}

      <section className="lp-card">
        <h2>Coverage</h2>
        <p className="lp-small lp-muted">
          {coverage?.attempted ?? 0} of {coverage?.total ?? 159} topics attempted. {timedCount} of{' '}
          {counted.length} counted essays were written under time.
        </p>
        <div className="lp-meter">
          <div
            className="lp-meter-fill"
            style={{ width: `${((coverage?.attempted ?? 0) / (coverage?.total || 159)) * 100}%` }}
          />
        </div>
      </section>

      <section className="lp-card">
        <h2>Essays</h2>
        <div className="lp-scroll-x">
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '38rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '0.8rem' }} className="lp-muted">
                <th style={{ padding: '0.5rem 0.4rem' }}>When</th>
                <th style={{ padding: '0.5rem 0.4rem' }}>Prompt</th>
                <th style={{ padding: '0.5rem 0.4rem' }}>Score</th>
                <th style={{ padding: '0.5rem 0.4rem' }}>Words</th>
                <th style={{ padding: '0.5rem 0.4rem' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {essays.map((essay) => (
                <tr key={essay.id} style={{ borderTop: '1px solid var(--md-sys-color-outline-variant)' }}>
                  <td style={{ padding: '0.6rem 0.4rem', fontSize: '0.85rem' }}>
                    {essay.createdAt?.slice(0, 10)}
                  </td>
                  <td style={{ padding: '0.6rem 0.4rem', fontSize: '0.85rem' }}>
                    {essay.statement.slice(0, 70)}
                    {essay.statement.length > 70 ? '...' : ''}
                    {essay.assisted && <span className="lp-tiny lp-muted"> (assisted)</span>}
                    {!essay.timed && <span className="lp-tiny lp-muted"> (untimed)</span>}
                  </td>
                  <td style={{ padding: '0.6rem 0.4rem', fontVariantNumeric: 'tabular-nums' }}>
                    {essay.scores ? essay.scores.holistic : '-'}
                  </td>
                  <td style={{ padding: '0.6rem 0.4rem', fontVariantNumeric: 'tabular-nums' }}>
                    {essay.wordCount}
                  </td>
                  <td style={{ padding: '0.6rem 0.4rem', fontVariantNumeric: 'tabular-nums' }}>
                    {formatDuration(essay.secondsUsed)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Least squares slope, used for the trend rather than comparing first to last. */
function trendSlope(values: number[]): number {
  if (values.length < 3) return 0;
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  return den === 0 ? 0 : num / den;
}

const round = (value: number) => Math.round(Math.min(6, Math.max(1, value)) * 2) / 2;

function Sparkline({ values }: { values: number[] }) {
  const width = 600;
  const height = 120;
  const pad = 8;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const y = (v: number) => height - pad - ((v - 1) / 5) * (height - pad * 2);
  const points = values.map((v, i) => `${pad + i * step},${y(v)}`).join(' ');

  return (
    <div className="lp-scroll-x">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Score trend">
        {[1, 2, 3, 4, 5, 6].map((mark) => (
          <line
            key={mark}
            x1={pad}
            x2={width - pad}
            y1={y(mark)}
            y2={y(mark)}
            stroke="var(--md-sys-color-outline-variant)"
            strokeWidth="1"
          />
        ))}
        <polyline points={points} fill="none" stroke="var(--md-sys-color-primary)" strokeWidth="2.5" />
        {values.map((v, i) => (
          <circle key={i} cx={pad + i * step} cy={y(v)} r="3.5" fill="var(--md-sys-color-primary)" />
        ))}
      </svg>
    </div>
  );
}

function adviceFor(key: string): string {
  const advice: Record<string, string> = {
    position:
      'Say which side you are on in the first paragraph, qualify it with "largely" rather than claiming it always holds, and make sure you are answering the specific task directions.',
    development:
      'Each body paragraph needs a reason and a concrete named example, then an explanation of why that example proves the point.',
    organization:
      'Aim for the five paragraph shape, open each paragraph with a transition, and make sure your concession paragraph actually rebuts what it concedes.',
    language:
      'Vary sentence length deliberately, and cut filler like "very" and "really" in favour of precise verbs.',
    conventions:
      'Leave two minutes at the end to reread. Most flagged errors are typos and comma splices you would catch on a second pass.',
  };
  return advice[key] ?? '';
}
