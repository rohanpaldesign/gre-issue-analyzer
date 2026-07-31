'use client';

import { useEffect, useState } from 'react';

type Trait = { key: string; label: string; score: number };

export type Score = {
  tooShort?: boolean;
  message?: string;
  holistic: number;
  band: { low: number; high: number; halfWidth: number; basis: string };
  traits: Trait[];
  structure: {
    passed: number;
    total: number;
    completion: number;
    items: Array<{ id: string; label: string; passed: boolean; detail: string; evidence: unknown }>;
  };
  features: {
    wordCount: number;
    paragraphCount: number;
    meanSentenceLength: number;
    sentenceLengthStdDev: number;
    lexicalDiversity: number;
    misspellings: string[];
    misspellingsPer100: number;
    mechanicsIssues: Array<{ type: string; detail: string | null }>;
    redundancy: number;
    concessions: number;
    completeMoves: number;
    danglingConcessions: number;
  };
};

type AiReview = {
  available: boolean;
  reason?: string;
  model?: string;
  holistic?: number;
  summary?: string;
  strengths?: Array<{ point: string; quote: string }>;
  weaknesses?: Array<{ point: string; quote: string; fix: string }>;
  reasoningCritique?: string;
  nextEssayAdvice?: string[];
};

export default function ScoreReport({
  score,
  essay,
  topic,
}: {
  score: Score;
  essay: string;
  topic: { statement: string; taskInstruction: string } | null;
}) {
  const [ai, setAi] = useState<AiReview | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    setAi(null);
  }, [essay]);

  async function runAi() {
    setAiLoading(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ essay, topic }),
      });
      setAi(await response.json());
    } catch {
      setAi({ available: false, reason: 'Could not reach the AI rater.' });
    } finally {
      setAiLoading(false);
    }
  }

  if (score.tooShort) {
    return <div className="lp-card">{score.message}</div>;
  }

  const f = score.features;

  return (
    <div className="lp-stack">
      <section className="lp-card">
        <div className="lp-spread">
          <div>
            <div className="lp-tiny lp-muted">Predicted score</div>
            <div className="lp-band">
              <span className="lp-band-value">
                {score.band.low} to {score.band.high}
              </span>
            </div>
          </div>
          <div className="lp-small lp-muted" style={{ maxWidth: '22rem' }}>
            Reported as a range, not a single number. {score.band.basis}
          </div>
        </div>
      </section>

      <section className="lp-card">
        <h2>ETS rubric traits</h2>
        {score.traits.map((trait) => (
          <div className="lp-trait" key={trait.key}>
            <div className="lp-trait-head">
              <span>{trait.label}</span>
              <span className="lp-muted">{trait.score} / 6</span>
            </div>
            <div className="lp-meter">
              <div className="lp-meter-fill" style={{ width: `${(trait.score / 6) * 100}%` }} />
            </div>
          </div>
        ))}
        <p className="lp-tiny lp-muted" style={{ marginTop: '0.85rem', marginBottom: 0 }}>
          These measure structure, development, variety and mechanics. They cannot judge whether your
          argument is actually sound. That is what the AI review below is for.
        </p>
      </section>

      <section className="lp-card">
        <div className="lp-spread">
          <h2 style={{ margin: 0 }}>Structure check</h2>
          <span className="lp-muted lp-small">
            {score.structure.passed} of {score.structure.total}
          </span>
        </div>
        <p className="lp-tiny lp-muted">
          The five paragraph approach, checked. This is a strategy, not the ETS rubric: ETS does not
          require five paragraphs, but this shape reliably produces what it does reward.
        </p>
        {score.structure.items.map((item) => (
          <div className="lp-check" key={item.id}>
            <span className={`lp-check-mark ${item.passed ? 'lp-pass' : 'lp-fail'}`}>
              {item.passed ? '✓' : '✕'}
            </span>
            <div>
              <div style={{ fontWeight: 500 }}>{item.label}</div>
              <div className="lp-small lp-muted">{item.detail}</div>
              <Evidence evidence={item.evidence} />
            </div>
          </div>
        ))}
      </section>

      <section className="lp-card">
        <h2>Mechanics</h2>
        <div className="lp-row lp-small">
          <span>{f.wordCount} words</span>
          <span className="lp-muted">·</span>
          <span>{f.paragraphCount} paragraphs</span>
          <span className="lp-muted">·</span>
          <span>
            {f.meanSentenceLength} words per sentence (variation {f.sentenceLengthStdDev})
          </span>
          <span className="lp-muted">·</span>
          <span>vocabulary range {f.lexicalDiversity}</span>
        </div>

        {f.misspellings.length > 0 && (
          <p className="lp-small" style={{ marginTop: '0.75rem' }}>
            <strong>Spelling:</strong>{' '}
            <span className="lp-fail">{f.misspellings.join(', ')}</span>
          </p>
        )}

        {f.mechanicsIssues.length > 0 && (
          <div className="lp-small" style={{ marginTop: '0.5rem' }}>
            <strong>Grammar and punctuation:</strong>
            <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
              {f.mechanicsIssues.slice(0, 8).map((issue, i) => (
                <li key={i}>
                  {readableIssue(issue.type)}
                  {issue.detail ? <span className="lp-muted"> in “{issue.detail}”</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        {f.misspellings.length === 0 && f.mechanicsIssues.length === 0 && (
          <p className="lp-small lp-muted" style={{ marginBottom: 0 }}>
            Nothing flagged.
          </p>
        )}
      </section>

      <section className="lp-card">
        <div className="lp-spread">
          <h2 style={{ margin: 0 }}>Is the argument any good?</h2>
          {!ai && (
            <button className="lp-btn" onClick={runAi} disabled={aiLoading}>
              {aiLoading ? 'Reading your essay...' : 'Run AI review'}
            </button>
          )}
        </div>

        {!ai && !aiLoading && (
          <p className="lp-small lp-muted">
            The scores above cannot tell a well-reasoned argument from a fluent empty one. This sends
            your essay to Google Gemini for that judgment. Free tier prompts may be used for training,
            so your essay is not private once you press this.
          </p>
        )}

        {ai && !ai.available && <p className="lp-small">{ai.reason}</p>}

        {ai?.available && (
          <div className="lp-stack" style={{ marginTop: '0.5rem' }}>
            {typeof ai.holistic === 'number' && (
              <div className="lp-small">
                <strong>Second opinion:</strong> {ai.holistic} / 6
                {Math.abs(ai.holistic - score.holistic) >= 1 && (
                  <span className="lp-muted">
                    {' '}
                    (the two raters disagree by {Math.abs(ai.holistic - score.holistic).toFixed(1)},
                    so treat the range as wider)
                  </span>
                )}
              </div>
            )}
            {ai.summary && <p style={{ marginBottom: 0 }}>{ai.summary}</p>}

            {ai.reasoningCritique && (
              <div>
                <h3>Reasoning</h3>
                <p style={{ marginBottom: 0 }}>{ai.reasoningCritique}</p>
              </div>
            )}

            {ai.weaknesses && ai.weaknesses.length > 0 && (
              <div>
                <h3>What to fix</h3>
                {ai.weaknesses.map((w, i) => (
                  <div key={i} style={{ marginBottom: '0.75rem' }}>
                    <div>{w.point}</div>
                    {w.quote && <div className="lp-quote lp-small">“{w.quote}”</div>}
                    {w.fix && (
                      <div className="lp-small lp-muted">
                        <strong>Instead:</strong> {w.fix}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {ai.strengths && ai.strengths.length > 0 && (
              <div>
                <h3>What worked</h3>
                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                  {ai.strengths.map((s, i) => (
                    <li key={i} className="lp-small">
                      {s.point}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {ai.nextEssayAdvice && ai.nextEssayAdvice.length > 0 && (
              <div>
                <h3>Next essay</h3>
                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                  {ai.nextEssayAdvice.map((a, i) => (
                    <li key={i} className="lp-small">
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** Show the sentences a check was based on, so the writer can disagree with it. */
function Evidence({ evidence }: { evidence: unknown }) {
  if (!evidence || typeof evidence !== 'object') return null;
  const data = evidence as {
    completed?: Array<{ concession: string; rebuttal: string; form: string }>;
    dangling?: string[];
  };

  return (
    <>
      {data.completed?.map((move, i) => (
        <div key={`c${i}`} className="lp-quote lp-tiny">
          Conceded: “{move.concession}”
          {move.form !== 'single-sentence' && <> Then: “{move.rebuttal}”</>}
        </div>
      ))}
      {data.dangling?.map((text, i) => (
        <div key={`d${i}`} className="lp-quote lp-tiny">
          Left unanswered: “{text}”
        </div>
      ))}
    </>
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
