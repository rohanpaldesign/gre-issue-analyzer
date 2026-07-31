'use client';

import { useState } from 'react';

type Reason = { claim: string; mechanism: string; exampleSlug: string | null };
type Example = {
  slug: string;
  title: string;
  domain: string;
  summary: string;
  keyFacts: string[];
  moves: string[];
  relevance: string;
};

type Guidance = {
  support: Reason[];
  oppose: Reason[];
  concessions: Record<string, { concession: string; rebuttal: string }>;
  examples: Example[];
};

/**
 * Both sides of the argument.
 *
 * While an attempt is in progress this is locked behind a confirmation, and
 * opening it marks the attempt assisted so it stays out of the score trend.
 * Reading the arguments before writing is a legitimate way to study, it just
 * is not a measurement of what you can do unaided.
 */
export default function GuidancePanel({
  topicId,
  locked,
  onReveal,
}: {
  topicId: number;
  locked: boolean;
  onReveal: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [loading, setLoading] = useState(false);
  const [side, setSide] = useState<'support' | 'oppose'>('support');

  async function reveal() {
    if (locked && !window.confirm('Opening this before you submit marks the attempt as assisted, so it will not count toward your score trend. Continue?')) {
      return;
    }
    setOpen(true);
    onReveal();
    if (guidance) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/topics/${topicId}/guidance`);
      setGuidance(await response.json());
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <div className="lp-card">
        <div className="lp-spread">
          <div>
            <h2 style={{ margin: 0 }}>Both sides of this prompt</h2>
            <p className="lp-small lp-muted" style={{ marginBottom: 0 }}>
              {locked
                ? 'Three reasons each way, the strongest concession, and the examples worth using. Hidden until you submit.'
                : 'Three reasons each way, the strongest concession for each side, and the examples worth preparing.'}
            </p>
          </div>
          <button className={locked ? 'lp-btn lp-btn-outlined' : 'lp-btn'} onClick={reveal}>
            {locked ? 'Show anyway' : 'Show'}
          </button>
        </div>
      </div>
    );
  }

  if (loading || !guidance) return <div className="lp-card lp-muted">Loading both sides...</div>;

  const reasons = side === 'support' ? guidance.support : guidance.oppose;
  const concession = guidance.concessions[side];
  const exampleFor = (slug: string | null) => guidance.examples.find((e) => e.slug === slug);

  return (
    <div className="lp-card">
      <div className="lp-spread">
        <h2 style={{ margin: 0 }}>Both sides of this prompt</h2>
        <div className="lp-row">
          <button className="lp-chip" aria-pressed={side === 'support'} onClick={() => setSide('support')}>
            Agreeing
          </button>
          <button className="lp-chip" aria-pressed={side === 'oppose'} onClick={() => setSide('oppose')}>
            Disagreeing
          </button>
        </div>
      </div>

      <p className="lp-tiny lp-muted">
        Pick one side and commit to it. Arguing both equally reads as having no position, which the
        rubric treats as a weakness rather than balance.
      </p>

      {reasons.map((reason, index) => {
        const example = exampleFor(reason.exampleSlug);
        return (
          <div key={index} style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 500 }}>
              {index + 1}. {reason.claim}
            </div>
            <div className="lp-small lp-muted">{reason.mechanism}</div>
            {example && (
              <div className="lp-quote lp-small">
                <strong>{example.title}.</strong> {example.summary}
              </div>
            )}
          </div>
        );
      })}

      {concession && (
        <div className="lp-card lp-card-tonal" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
          <h3 style={{ marginTop: 0 }}>Concede this, then shut it down</h3>
          <p className="lp-small">
            <strong>Concede:</strong> {concession.concession}
          </p>
          <p className="lp-small" style={{ marginBottom: 0 }}>
            <strong>Then:</strong> {concession.rebuttal}
          </p>
        </div>
      )}

      {guidance.examples.length > 0 && (
        <details style={{ marginTop: '1rem' }}>
          <summary style={{ cursor: 'pointer' }}>
            Examples worth preparing ({guidance.examples.length})
          </summary>
          <p className="lp-tiny lp-muted" style={{ marginTop: '0.5rem' }}>
            These recur across the pool. Learning a small set well beats trying to memorise something
            for all 159 prompts.
          </p>
          {guidance.examples.map((example) => (
            <div key={example.slug} style={{ marginBottom: '0.85rem' }}>
              <div style={{ fontWeight: 500 }}>
                {example.title} <span className="lp-tiny lp-muted">({example.domain})</span>
              </div>
              <div className="lp-small lp-muted">{example.summary}</div>
              {example.keyFacts.length > 0 && (
                <div className="lp-tiny lp-muted">Facts: {example.keyFacts.join(' · ')}</div>
              )}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
