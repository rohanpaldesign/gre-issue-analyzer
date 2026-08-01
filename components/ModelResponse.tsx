'use client';

import { useEffect, useState } from 'react';

type Reason = { claim: string; mechanism: string; exampleSlug: string | null };
type Example = { slug: string; title: string; summary: string; keyFacts: string[] };
type Guidance = {
  support: Reason[];
  oppose: Reason[];
  concessions: Record<string, { concession: string; rebuttal: string }>;
  examples: Example[];
};

const STANCE_LABEL: Record<string, string> = {
  support: 'Mostly Agree',
  oppose: 'Mostly Disagree',
};

/**
 * A worked response for each stance, laid out in the shape the essay should
 * take: introduction, two supports, concession and rebuttal, conclusion.
 *
 * The reasons are stored individually rather than as prose, so the paragraphs
 * are composed here. That keeps one authored reason reusable in several places
 * instead of duplicating it into a fixed essay.
 */
export default function ModelResponse({ topicId }: { topicId: number }) {
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch(`/api/topics/${topicId}/guidance`)
      .then((r) => r.json())
      .then(setGuidance)
      .catch(() => setFailed(true));
  }, [topicId]);

  if (failed) return null;
  if (!guidance) {
    return (
      <section className="gre-section">
        <h2 className="gre-section-title">Example responses</h2>
        <p className="gre-muted">Loading...</p>
      </section>
    );
  }

  const sides: Array<'support' | 'oppose'> = ['support', 'oppose'];

  return (
    <>
      {sides.map((side, index) => {
        const reasons = side === 'support' ? guidance.support : guidance.oppose;
        const concession = guidance.concessions[side];
        const expanded = Boolean(showAll[side]);
        const shown = expanded ? reasons : reasons.slice(0, 2);
        const exampleFor = (slug: string | null) => guidance.examples.find((e) => e.slug === slug);

        return (
          <section className="gre-section" key={side}>
            <div className="gre-example-head">
              <div>
                <h2 className="gre-example-title">Example {String(index + 1).padStart(2, '0')}</h2>
                <p className="gre-example-stance">{STANCE_LABEL[side]}</p>
              </div>
              {reasons.length > 2 && (
                <button
                  className="gre-btn-light"
                  onClick={() => setShowAll((s) => ({ ...s, [side]: !expanded }))}
                >
                  {expanded
                    ? `Show fewer supports`
                    : `Show all supports for ${STANCE_LABEL[side]}`}
                </button>
              )}
            </div>

            <div className="gre-block">
              <div className="gre-block-label">Introduction</div>
              <div className="gre-block-body">
                State the position outright and qualify it: “I {side === 'support' ? 'largely agree' : 'largely disagree'} with
                this {' '}
                {'statement'}.” Then signal the two reasons that follow, so the reader knows the shape
                of the argument before it starts.
              </div>
            </div>

            {shown.map((reason, i) => (
              <div className="gre-block" key={i}>
                <div className="gre-block-label">Support paragraph {String(i + 1).padStart(2, '0')}</div>
                <div className="gre-block-body">
                  <strong>{reason.claim}</strong> {reason.mechanism}
                  {(() => {
                    const example = exampleFor(reason.exampleSlug);
                    return example ? (
                      <>
                        {' '}
                        <em>{example.title}:</em> {example.summary}
                      </>
                    ) : null;
                  })()}
                </div>
              </div>
            ))}

            {concession && (
              <div className="gre-block">
                <div className="gre-block-label">Concession and rebuttal</div>
                <div className="gre-block-body">
                  <strong>Concede:</strong> {concession.concession}
                  <br />
                  <strong>Then shut it down:</strong> {concession.rebuttal}
                </div>
              </div>
            )}

            <div className="gre-block">
              <div className="gre-block-label">Conclusion</div>
              <div className="gre-block-body">
                Restate the qualified position and say why the distinction matters, rather than simply
                repeating the introduction in different words.
              </div>
            </div>
          </section>
        );
      })}

      {guidance.examples.length > 0 && (
        <section className="gre-section">
          <h2 className="gre-section-title">Examples worth preparing</h2>
          <p className="gre-small gre-muted">
            These recur across the pool. Learning a small set properly beats trying to memorise
            something for every prompt.
          </p>
          {guidance.examples.map((example) => (
            <div className="gre-block" key={example.slug}>
              <div className="gre-block-label">{example.title}</div>
              <div className="gre-block-body">
                {example.summary}
                {example.keyFacts.length > 0 && (
                  <div className="gre-tiny gre-muted" style={{ marginTop: '0.4rem', fontFamily: 'var(--sans)' }}>
                    {example.keyFacts.join(' · ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
