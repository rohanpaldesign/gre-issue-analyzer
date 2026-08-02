'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppBar from '@/components/AppBar';
import ModelResponse from '@/components/ModelResponse';
import AiReview from '@/components/AiReview';
import { getSyncCode } from '@/lib/session';
import type { ScoreResult } from '@/lib/scoring';

type Previous = {
  id: string;
  holistic: number | null;
  wordCount: number;
  traits: Array<{ key: string; label: string; score: number }>;
  failedChecks: Array<{ id: string; label: string }>;
};

type EssayRecord = {
  id: string;
  topicId: number;
  essay: string;
  saved: boolean;
  createdAt: string;
  revisionOf: string | null;
  previous: Previous | null;
  topic: { id: number; statement: string; taskInstruction: string; taskType: string };
  score: ScoreResult | null;
};

export default function ResultPage({ params }: { params: { id: string } }) {
  const [record, setRecord] = useState<EssayRecord | null>(null);
  const [saved, setSaved] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/essays/${params.id}?syncCode=${encodeURIComponent(getSyncCode())}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('missing'))))
      .then((data) => {
        setRecord(data);
        setSaved(Boolean(data.saved));
      })
      .catch(() => setNotFound(true));
  }, [params.id]);

  async function saveForLater() {
    await fetch(`/api/essays/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncCode: getSyncCode(), saved: true }),
    });
    setSaved(true);
  }

  if (notFound) {
    return (
      <>
        <AppBar
          contextTitle="Result"
          actions={
            <Link href="/" className="gre-btn">
              Home
            </Link>
          }
        />
        <div className="gre-page">That essay was not found under your sync code.</div>
      </>
    );
  }

  if (!record) {
    return (
      <>
        <AppBar contextTitle="Result" />
        <div className="gre-page gre-muted">Loading your result...</div>
      </>
    );
  }

  const score = record.score;

  return (
    <>
      <AppBar
        contextTitle="Result"
        actions={
          <>
            <Link href="/" className="gre-btn">
              Home
            </Link>
            <button className="gre-btn gre-btn-primary" onClick={saveForLater} disabled={saved}>
              {saved ? 'Saved' : 'Save for later'}
            </button>
            <Link href={`/write?revise=${record.id}`} className="gre-btn gre-btn-primary">
              Revise
            </Link>
          </>
        }
      />

      <div className="gre-split">
        <div className="gre-pane-left">
          <h2 className="gre-pane-title">User Answer</h2>
          <div className="gre-prose">{record.essay}</div>
        </div>

        <div className="gre-pane-right">
          {score && !score.tooShort ? (
            <>
              <section className="gre-section">
                <h2 className="gre-section-title">Grade</h2>
                <div className="gre-grade">{score.holistic.toFixed(1)}</div>
                {score.lengthCeiling && (
                  <div className="gre-grade-sub" style={{ color: 'var(--accent-bad)' }}>
                    {score.lengthCeiling}
                  </div>
                )}
                <div className="gre-grade-sub">{score.band.basis}</div>
              </section>

              {record.previous && (
                <Comparison previous={record.previous} score={score} />
              )}

              <section className="gre-section">
                <h2 className="gre-section-title">Areas to improve</h2>
                <ImproveList score={score} />
              </section>

              <AiReview essay={record.essay} topic={record.topic} heuristicScore={score.holistic} />
            </>
          ) : (
            <section className="gre-section">
              <h2 className="gre-section-title">Grade</h2>
              <p className="gre-muted">
                This response was too short to score. Write at least 25 words.
              </p>
            </section>
          )}

          <ModelResponse topicId={record.topicId} />
        </div>
      </div>
    </>
  );
}

/**
 * What moved since the attempt this reworks.
 *
 * Leads the page because it is the entire payoff of revising. Structure checks
 * that flipped are called out by name: those are the concrete, repeatable wins.
 */
function Comparison({ previous, score }: { previous: Previous; score: ScoreResult }) {
  const before = previous.holistic;
  const after = score.holistic;
  const delta = before === null ? null : after - before;

  const nowFailing = new Set(score.structure.items.filter((i) => !i.passed).map((i) => i.id));
  const fixed = previous.failedChecks.filter((check) => !nowFailing.has(check.id));
  const stillFailing = previous.failedChecks.filter((check) => nowFailing.has(check.id));

  const traitDelta = score.traits.map((trait) => {
    const was = previous.traits.find((t) => t.key === trait.key);
    return { ...trait, was: was?.score ?? null, change: was ? trait.score - was.score : null };
  });

  return (
    <section className="gre-section">
      <h2 className="gre-section-title">Compared with your previous attempt</h2>

      <div className="gre-row" style={{ alignItems: 'baseline', gap: '1rem', marginBottom: '1rem' }}>
        <span className="gre-grade" style={{ fontSize: '2.5rem' }}>
          {before === null ? '--' : before.toFixed(1)}
        </span>
        <span className="gre-muted" aria-hidden="true">to</span>
        <span className="gre-grade" style={{ fontSize: '2.5rem' }}>
          {after.toFixed(1)}
        </span>
        {delta !== null && (
          <span className={delta > 0 ? 'gre-pass' : delta < 0 ? 'gre-fail' : 'gre-muted'} style={{ fontWeight: 700 }}>
            {delta > 0 ? '+' : ''}
            {delta.toFixed(1)}
          </span>
        )}
      </div>

      {fixed.length > 0 && (
        <div className="gre-improve-item">
          <div className="gre-improve-head">
            <span className="gre-improve-mark gre-pass">✓</span>
            <span>Fixed: {fixed.map((c) => c.label).join(', ')}</span>
          </div>
        </div>
      )}

      {stillFailing.length > 0 && (
        <div className="gre-improve-item">
          <div className="gre-improve-head">
            <span className="gre-improve-mark gre-fail">✕</span>
            <span>Still open: {stillFailing.map((c) => c.label).join(', ')}</span>
          </div>
        </div>
      )}

      <div className="gre-scroll-x">
        <table className="gre-table" style={{ minWidth: '26rem' }}>
          <thead>
            <tr>
              <th>Trait</th>
              <th>Before</th>
              <th>After</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {traitDelta.map((trait) => (
              <tr key={trait.key}>
                <td>{trait.label}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{trait.was ?? '--'}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{trait.score}</td>
                <td
                  className={trait.change === null ? '' : trait.change > 0 ? 'gre-pass' : trait.change < 0 ? 'gre-fail' : ''}
                  style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                >
                  {trait.change === null ? '--' : `${trait.change > 0 ? '+' : ''}${trait.change.toFixed(1)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="gre-tiny gre-muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
        Revisions are kept out of your score trend, since rewriting one essay repeatedly would make
        the line rise on its own. The gain is reported separately on the dashboard.
      </p>
    </section>
  );
}

/**
 * What to fix, worst first.
 *
 * Failed structure checks come first because they are concrete and actionable,
 * then the weakest rubric traits, then mechanics. Everything shows the evidence
 * it is based on so the writer can disagree with a detector that got it wrong.
 */
function ImproveList({ score }: { score: ScoreResult }) {
  const failures = score.structure.items.filter((item) => !item.passed);
  const traits = [...score.traits].sort((a, b) => a.score - b.score).slice(0, 2);
  const misspellings = score.features.misspellings;
  const issues = score.features.mechanicsIssues;

  if (failures.length === 0 && traits[0].score >= 5 && misspellings.length === 0) {
    return <p className="gre-muted">Nothing significant. This is a strong response.</p>;
  }

  return (
    <div>
      {failures.map((item) => (
        <div className="gre-improve-item" key={item.id}>
          <div className="gre-improve-head">
            <span className="gre-improve-mark gre-fail">✕</span>
            <span>{item.label}</span>
          </div>
          <div className="gre-small gre-muted" style={{ marginLeft: '1.5rem' }}>
            {item.detail}
          </div>
          <Evidence evidence={item.evidence} />
        </div>
      ))}

      {traits.map((trait) => (
        <div className="gre-improve-item" key={trait.key}>
          <div className="gre-improve-head">
            <span>{trait.label}</span>
            <span className="gre-muted" style={{ fontWeight: 400 }}>
              {trait.score} of 6
            </span>
          </div>
          <div className="gre-meter" style={{ marginTop: '0.35rem', maxWidth: '22rem' }}>
            <div className="gre-meter-fill" style={{ width: `${(trait.score / 6) * 100}%` }} />
          </div>
        </div>
      ))}

      {misspellings.length > 0 && (
        <div className="gre-improve-item">
          <div className="gre-improve-head">
            <span className="gre-improve-mark gre-fail">✕</span>
            <span>Spelling</span>
          </div>
          <div className="gre-small gre-muted" style={{ marginLeft: '1.5rem' }}>
            {misspellings.join(', ')}
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <div className="gre-improve-item">
          <div className="gre-improve-head">
            <span className="gre-improve-mark gre-fail">✕</span>
            <span>Grammar and punctuation</span>
          </div>
          <ul className="gre-list gre-small gre-muted" style={{ marginLeft: '1.5rem', marginTop: '0.3rem' }}>
            {issues.slice(0, 6).map((issue, index) => (
              <li key={index}>
                {readableIssue(issue.type)}
                {issue.detail ? <span> in “{issue.detail}”</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="gre-tiny gre-muted" style={{ marginTop: '1rem', marginBottom: 0 }}>
        These measure structure, development, variety and mechanics. Whether the argument itself holds
        up is judged separately below.
      </p>
    </div>
  );
}

function Evidence({ evidence }: { evidence: unknown }) {
  if (!evidence || typeof evidence !== 'object') return null;
  const data = evidence as { completed?: Array<{ concession: string }>; dangling?: string[] };
  return (
    <div style={{ marginLeft: '1.5rem' }}>
      {data.dangling?.slice(0, 2).map((text, index) => (
        <div key={index} className="gre-quote gre-small">
          Left unanswered: “{text}”
        </div>
      ))}
    </div>
  );
}

function readableIssue(type: string): string {
  const labels: Record<string, string> = {
    'comma-splice': 'Comma splice',
    'run-on': 'Run-on sentence',
    fragment: 'Sentence fragment',
    'its-vs-its': 'its versus it is',
    'there-vs-their': 'there versus their',
    'could-of': 'could of, should be could have',
    alot: 'alot, should be a lot',
    capitalisation: 'Sentence does not start with a capital',
    'punctuation-spacing': 'Missing space after punctuation',
  };
  return labels[type] ?? type;
}
