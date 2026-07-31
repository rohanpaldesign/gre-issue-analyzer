'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ScoreReport, { type Score } from '@/components/ScoreReport';
import GuidancePanel from '@/components/GuidancePanel';
import { clearDraft, countWords, formatDuration, getSyncCode, loadDraft, saveDraft } from '@/lib/session';

type Topic = {
  id: number;
  statement: string;
  taskInstruction: string;
  taskType: string;
  claim: string | null;
  reason: string | null;
  themes: string[];
};

const EXAM_SECONDS = 30 * 60;

export default function WritePage() {
  const [topic, setTopic] = useState<Topic | null>(null);
  const [essay, setEssay] = useState('');
  const [timed, setTimed] = useState(true);
  const [started, setStarted] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(EXAM_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const [score, setScore] = useState<Score | null>(null);
  const [scoring, setScoring] = useState(false);
  const [assisted, setAssisted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const composer = useRef<HTMLTextAreaElement>(null);

  const loadTopic = useCallback(async (nextTimed = timed) => {
    setLoading(true);
    setScore(null);
    setEssay('');
    setAssisted(false);
    setSaved(false);
    setStarted(false);
    setSecondsLeft(EXAM_SECONDS);
    setElapsed(0);
    setTimed(nextTimed);
    clearDraft();

    const response = await fetch(`/api/topics?mode=random&userId=${encodeURIComponent(getSyncCode())}`);
    const data = await response.json();
    setTopic(data.topic);
    setLoading(false);
  }, [timed]);

  // Restore an interrupted attempt before fetching anything new.
  useEffect(() => {
    const draft = loadDraft();
    if (draft && draft.essay.trim()) {
      fetch(`/api/topics/${draft.topicId}/guidance`)
        .then((r) => r.json())
        .then((data) => {
          if (!data.topic) return loadTopic();
          setTopic(data.topic);
          setEssay(draft.essay);
          setTimed(draft.timed);
          setAssisted(draft.assisted);
          setStarted(true);
          setElapsed(draft.secondsUsed);
          setSecondsLeft(Math.max(0, EXAM_SECONDS - draft.secondsUsed));
          setLoading(false);
        })
        .catch(() => loadTopic());
    } else {
      loadTopic();
    }
    // Intentionally runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clock.
  useEffect(() => {
    if (!started || score) return undefined;
    const tick = setInterval(() => {
      setElapsed((e) => e + 1);
      if (timed) setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, [started, timed, score]);

  // Autosave.
  useEffect(() => {
    if (!topic || !started || score) return;
    saveDraft({ topicId: topic.id, essay, startedAt: Date.now(), secondsUsed: elapsed, timed, assisted });
  }, [essay, topic, started, elapsed, timed, assisted, score]);

  const submit = useCallback(async () => {
    if (!topic || scoring) return;
    setScoring(true);
    try {
      const response = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ essay, topic }),
      });
      const result: Score = await response.json();
      setScore(result);
      clearDraft();

      if (!result.tooShort) {
        const saveResponse = await fetch('/api/essays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            syncCode: getSyncCode(),
            topicId: topic.id,
            essay,
            secondsUsed: elapsed,
            timed,
            assisted,
            scores: result,
          }),
        });
        setSaved(saveResponse.ok);
      }
    } finally {
      setScoring(false);
    }
  }, [topic, essay, elapsed, timed, assisted, scoring]);

  // Time up submits automatically, exactly as the real test would.
  useEffect(() => {
    if (timed && started && secondsLeft === 0 && !score && countWords(essay) >= 25) submit();
  }, [secondsLeft, timed, started, score, essay, submit]);

  const words = countWords(essay);

  if (loading) return <p className="lp-muted">Loading a prompt...</p>;
  if (!topic) return <p>No topics found. Has the database been seeded?</p>;

  return (
    <div className="lp-stack">
      <section className="lp-card lp-card-tonal">
        <div className="lp-tiny" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.75 }}>
          Topic {topic.id} · {readableTaskType(topic.taskType)}
        </div>
        <p style={{ fontSize: '1.0625rem', marginTop: '0.5rem' }}>{topic.statement}</p>
        <p className="lp-small" style={{ marginBottom: 0, opacity: 0.85 }}>
          {topic.taskInstruction}
        </p>
      </section>

      {!score && (
        <>
          <div className="lp-row">
            {!started && (
              <>
                <button className="lp-btn" onClick={() => { setStarted(true); composer.current?.focus(); }}>
                  Start {timed ? '30 minute' : 'untimed'} attempt
                </button>
                <button className="lp-chip" aria-pressed={timed} onClick={() => setTimed(true)}>
                  Timed
                </button>
                <button className="lp-chip" aria-pressed={!timed} onClick={() => setTimed(false)}>
                  Untimed
                </button>
              </>
            )}
            <button className="lp-btn-text lp-btn" onClick={() => loadTopic(timed)}>
              Different prompt
            </button>
          </div>

          {started && (
            <div>
              <div className="lp-composer-status">
                <span className={`lp-timer ${timed && secondsLeft <= 300 ? 'lp-timer-low' : ''}`}>
                  {timed ? formatDuration(secondsLeft) : formatDuration(elapsed)}
                </span>
                <span className="lp-small lp-muted">
                  {words} words{words >= 500 && words <= 600 ? ' · on target' : ''}
                </span>
                <button className="lp-btn" onClick={submit} disabled={scoring || words < 25}>
                  {scoring ? 'Scoring...' : 'Submit'}
                </button>
              </div>
              <textarea
                ref={composer}
                className="lp-composer"
                value={essay}
                onChange={(event) => setEssay(event.target.value)}
                placeholder="Take a position in your first paragraph, then defend it. Leave a blank line between paragraphs."
                spellCheck={false}
                aria-label="Your essay"
              />
              <p className="lp-tiny lp-muted" style={{ marginTop: '0.4rem' }}>
                Saved as you type. Spellcheck is off on purpose, since the real test has none.
              </p>
            </div>
          )}

          {started && (
            <GuidancePanel
              topicId={topic.id}
              locked
              onReveal={() => setAssisted(true)}
            />
          )}
        </>
      )}

      {score && (
        <>
          <div className="lp-row">
            <button className="lp-btn" onClick={() => loadTopic(timed)}>
              Next prompt
            </button>
            <button
              className="lp-btn lp-btn-outlined"
              onClick={() => {
                setScore(null);
                setStarted(true);
              }}
            >
              Revise this essay
            </button>
            {saved && <span className="lp-tiny lp-muted">Saved to your history</span>}
            {assisted && (
              <span className="lp-tiny lp-muted">
                Marked as assisted, so it is excluded from your score trend
              </span>
            )}
          </div>

          <ScoreReport score={score} essay={essay} topic={topic} />

          <GuidancePanel topicId={topic.id} locked={false} onReveal={() => undefined} />
        </>
      )}
    </div>
  );
}

function readableTaskType(taskType: string): string {
  const labels: Record<string, string> = {
    statement: 'Agree or disagree with the statement',
    claim: 'Agree or disagree with the claim',
    'claim-reason': 'Claim and the reason behind it',
    recommendation: 'Agree or disagree with the recommendation',
    'two-views': 'Two competing views',
    policy: 'Your view on a policy',
  };
  return labels[taskType] ?? taskType;
}
