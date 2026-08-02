'use client';

import { useEffect, useState } from 'react';

type Reason = { claim: string; mechanism: string; exampleSlug: string | null };
type Example = { slug: string; title: string; summary: string; keyFacts: string[] };
type ModelEssay = {
  intro: string;
  support1: string;
  support2: string;
  concession: string;
  conclusion: string;
  wordCount: number;
};

type Guidance = {
  support: Reason[];
  oppose: Reason[];
  concessions: Record<string, { concession: string; rebuttal: string }>;
  modelEssays: Record<string, ModelEssay>;
  examples: Example[];
};

const STANCE_LABEL: Record<string, string> = {
  support: 'Mostly Agree',
  oppose: 'Mostly Disagree',
};

/**
 * A worked response for each stance, in the shape the essay should take:
 * introduction, two supports, concession and rebuttal, conclusion.
 *
 * The paragraphs are real prose, written from that topic's own authored reasons
 * so the example and the guidance argue the same case, and accepted only if the
 * app's own scorer grades them 5.0 or above.
 *
 * Topics whose essays have not been written yet fall back to the reason list,
 * because authoring runs against a small daily quota and lands over several
 * days. The fallback is a summary of the argument, not a worked example.
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
        const essay = guidance.modelEssays?.[side];

        return (
          <section className="gre-section" key={side}>
            <div className="gre-example-head">
              <div>
                <h2 className="gre-example-title">Example {String(index + 1).padStart(2, '0')}</h2>
                <p className="gre-example-stance">{STANCE_LABEL[side]}</p>
                {essay && (
                  <p className="gre-tiny gre-muted" style={{ margin: 0 }}>
                    {essay.wordCount} words, the length this should run to
                  </p>
                )}
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
                {essay
                  ? essay.intro
                  : `Open by stating the position outright and qualifying it, then signal the two reasons that follow.`}
              </div>
            </div>

            {shown.map((reason, i) => (
              <div className="gre-block" key={i}>
                <div className="gre-block-label">Support paragraph {String(i + 1).padStart(2, '0')}</div>
                <div className="gre-block-body">
                  {essay && i === 0 && essay.support1}
                  {essay && i === 1 && essay.support2}
                  {(!essay || i > 1) && (
                    <>
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
                    </>
                  )}
                </div>
              </div>
            ))}

            {concession && (
              <div className="gre-block">
                <div className="gre-block-label">Concession and rebuttal</div>
                <div className="gre-block-body">
                  {essay ? (
                    essay.concession
                  ) : (
                    <>
                      <strong>Concede:</strong> {concession.concession}
                      <br />
                      <strong>Then shut it down:</strong> {concession.rebuttal}
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="gre-block">
              <div className="gre-block-label">Conclusion</div>
              <div className="gre-block-body">
                {essay
                  ? essay.conclusion
                  : 'Restate the qualified position and say why the distinction matters, rather than repeating the introduction in different words.'}
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
