'use client';

import { useState } from 'react';

type Review = {
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

/**
 * The second rater.
 *
 * The rubric engine measures surface correlates of quality and cannot tell a
 * well-reasoned argument from a fluent empty one. This is the part that can,
 * so it is presented as a separate judgment rather than folded into the grade.
 */
export default function AiReview({
  essay,
  topic,
  heuristicScore,
}: {
  essay: string;
  topic: { statement: string; taskInstruction: string };
  heuristicScore: number;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ essay, topic }),
      });
      setReview(await response.json());
    } catch {
      setReview({ available: false, reason: 'Could not reach the AI rater.' });
    } finally {
      setLoading(false);
    }
  }

  const disagreement = review?.holistic != null ? Math.abs(review.holistic - heuristicScore) : 0;

  return (
    <section className="gre-section">
      <div className="gre-example-head">
        <h2 className="gre-section-title" style={{ margin: 0 }}>
          Is the argument any good?
        </h2>
        {!review && (
          <button className="gre-btn-light" onClick={run} disabled={loading}>
            {loading ? 'Reading...' : 'Run AI review'}
          </button>
        )}
      </div>

      {!review && !loading && (
        <p className="gre-small gre-muted">
          The grade above cannot judge reasoning. This sends your essay to Google Gemini for that.
          Free tier prompts may be used for training, so your essay is not private once you press it.
        </p>
      )}

      {review && !review.available && <p className="gre-small">{review.reason}</p>}

      {review?.available && (
        <div className="gre-stack">
          {review.holistic != null && (
            <div className="gre-small">
              <strong>Second opinion: {review.holistic.toFixed(1)}</strong>
              {disagreement >= 1 && (
                <span className="gre-muted">
                  {' '}
                  The two raters disagree by {disagreement.toFixed(1)}, so treat the range as wider
                  than shown above.
                </span>
              )}
            </div>
          )}

          {review.summary && <p style={{ margin: 0 }}>{review.summary}</p>}

          {review.reasoningCritique && (
            <div>
              <h3 style={{ fontSize: '1rem', margin: '0 0 0.3rem' }}>Reasoning</h3>
              <p style={{ margin: 0 }}>{review.reasoningCritique}</p>
            </div>
          )}

          {review.weaknesses && review.weaknesses.length > 0 && (
            <div>
              <h3 style={{ fontSize: '1rem', margin: '0 0 0.4rem' }}>What to fix</h3>
              {review.weaknesses.map((weakness, index) => (
                <div key={index} style={{ marginBottom: '0.8rem' }}>
                  <div>{weakness.point}</div>
                  {weakness.quote && <div className="gre-quote gre-small">“{weakness.quote}”</div>}
                  {weakness.fix && (
                    <div className="gre-small gre-muted">
                      <strong>Instead:</strong> {weakness.fix}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {review.strengths && review.strengths.length > 0 && (
            <div>
              <h3 style={{ fontSize: '1rem', margin: '0 0 0.4rem' }}>What worked</h3>
              <ul className="gre-list gre-small">
                {review.strengths.map((strength, index) => (
                  <li key={index}>{strength.point}</li>
                ))}
              </ul>
            </div>
          )}

          {review.nextEssayAdvice && review.nextEssayAdvice.length > 0 && (
            <div>
              <h3 style={{ fontSize: '1rem', margin: '0 0 0.4rem' }}>Next essay</h3>
              <ul className="gre-list gre-small">
                {review.nextEssayAdvice.map((advice, index) => (
                  <li key={index}>{advice}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
