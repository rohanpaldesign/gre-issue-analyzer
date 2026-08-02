'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import AppBar from '@/components/AppBar';
import {
  clearDraft, countWords, formatDuration, getPreference, getSyncCode, loadDraft, saveDraft, setPreference,
} from '@/lib/session';

type Topic = {
  id: number;
  statement: string;
  taskInstruction: string;
  taskType: string;
};

const EXAM_SECONDS = 30 * 60;

type FailedCheck = { id: string; label: string; detail: string };
type Trait = { key: string; label: string; score: number };

/**
 * Reading the query string opts the route out of prerendering, so the composer
 * sits behind a Suspense boundary. Without it the build fails outright rather
 * than degrading, because Next tries to statically export this page.
 */
export default function WritePage() {
  return (
    <Suspense
      fallback={
        <>
          <AppBar contextTitle="Loading" />
          <div className="gre-page gre-muted">Opening the composer...</div>
        </>
      }
    >
      <Composer />
    </Suspense>
  );
}

function Composer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reviseId = searchParams.get('revise');
  const [topic, setTopic] = useState<Topic | null>(null);
  const [essay, setEssay] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(EXAM_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const [showTime, setShowTime] = useState(true);
  // Off by default. The real ETS word processor offers insert, delete, cut,
  // paste and undo, and no word counter or spell check, so a live count trains
  // a habit that will not exist on the day.
  const [showWordCount, setShowWordCount] = useState(false);

  // Revision state. A revision reworks an earlier attempt, so it is untimed and
  // carries that attempt's failed checks beside the prompt.
  const [revisionOf, setRevisionOf] = useState<string | null>(null);
  const [revisionNumber, setRevisionNumber] = useState(1);
  const [failedChecks, setFailedChecks] = useState<FailedCheck[]>([]);
  const [weakTraits, setWeakTraits] = useState<Trait[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Undo and redo are kept here rather than relying on the browser's own stack,
  // which is cleared whenever the value is set programmatically.
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const lastPush = useRef(0);

  useEffect(() => setShowWordCount(getPreference('wordCount', false)), []);

  useEffect(() => {
    if (reviseId) {
      loadForRevision(reviseId);
      return;
    }
    const draft = loadDraft();
    if (draft?.revisionOf) {
      loadForRevision(draft.revisionOf, draft.essay);
      return;
    }
    if (draft?.essay?.trim()) {
      fetch(`/api/topics/${draft.topicId}/guidance`)
        .then((r) => r.json())
        .then((data) => {
          if (!data.topic) throw new Error('gone');
          setTopic(data.topic);
          setEssay(draft.essay);
          setElapsed(draft.secondsUsed);
          setSecondsLeft(Math.max(0, EXAM_SECONDS - draft.secondsUsed));
          setLoading(false);
        })
        .catch(() => loadNewTopic());
    } else {
      loadNewTopic();
    }
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Open an earlier attempt for reworking.
   *
   * The essay comes back with the score that was reported at the time, so the
   * checks shown beside the composer are the ones the writer is actually
   * fixing rather than a fresh rescore of half-edited text.
   */
  async function loadForRevision(parentId: string, resumeText?: string) {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/essays/${parentId}?syncCode=${encodeURIComponent(getSyncCode())}`
      );
      if (!response.ok) throw new Error('not found');
      const record = await response.json();

      setTopic(record.topic);
      setEssay(resumeText ?? record.essay);
      setRevisionOf(parentId);
      setRevisionNumber((record.previous ? 2 : 1) + 1);
      setFailedChecks(
        (record.score?.structure?.items ?? [])
          .filter((item: { passed: boolean }) => !item.passed)
          .map((item: { id: string; label: string; detail: string }) => ({
            id: item.id,
            label: item.label,
            detail: item.detail,
          }))
      );
      setWeakTraits([...(record.score?.traits ?? [])].sort((a: Trait, b: Trait) => a.score - b.score).slice(0, 2));
      setElapsed(0);
      undoStack.current = [];
      redoStack.current = [];
      setCanUndo(false);
      setCanRedo(false);
      setLoading(false);
    } catch {
      loadNewTopic();
    }
  }

  async function loadNewTopic() {
    setLoading(true);
    const response = await fetch(`/api/topics?mode=random&userId=${encodeURIComponent(getSyncCode())}`);
    const data = await response.json();
    setTopic(data.topic);
    setEssay('');
    setElapsed(0);
    setSecondsLeft(EXAM_SECONDS);
    setRevisionOf(null);
    setFailedChecks([]);
    setWeakTraits([]);
    undoStack.current = [];
    redoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
    clearDraft();
    setLoading(false);
  }

  useEffect(() => {
    if (loading || submitting) return undefined;
    const tick = setInterval(() => {
      setElapsed((e) => e + 1);
      // Revising is deliberate practice, not a test simulation, so no clock
      // runs down. Elapsed time is still recorded.
      if (!revisionOf) setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, [loading, submitting, revisionOf]);

  useEffect(() => {
    if (!topic || loading) return;
    saveDraft({
      topicId: topic.id,
      essay,
      startedAt: Date.now(),
      secondsUsed: elapsed,
      timed: !revisionOf,
      assisted: false,
      revisionOf,
    });
  }, [essay, topic, elapsed, loading, revisionOf]);

  const submit = useCallback(
    async (saveOnly = false) => {
      if (!topic || submitting) return;
      setSubmitting(true);
      try {
        const scoreResponse = await fetch('/api/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ essay, topic }),
        });
        const score = await scoreResponse.json();

        const saveResponse = await fetch('/api/essays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            syncCode: getSyncCode(),
            topicId: topic.id,
            essay,
            secondsUsed: elapsed,
            timed: !revisionOf,
            assisted: false,
            saved: saveOnly,
            revisionOf,
            scores: score.tooShort ? null : score,
          }),
        });
        const saved = await saveResponse.json();
        clearDraft();
        router.push(saveOnly ? '/saved' : `/result/${saved.id}`);
      } finally {
        setSubmitting(false);
      }
    },
    [topic, essay, elapsed, submitting, router, revisionOf]
  );

  // Time up submits automatically, exactly as the real test does.
  useEffect(() => {
    if (!revisionOf && secondsLeft === 0 && !submitting && countWords(essay) >= 25) submit(false);
  }, [secondsLeft, submitting, essay, submit, revisionOf]);

  function pushUndo(previous: string) {
    // Coalesce rapid keystrokes so undo steps are useful rather than per-letter.
    const now = Date.now();
    if (now - lastPush.current > 700) {
      undoStack.current.push(previous);
      if (undoStack.current.length > 100) undoStack.current.shift();
      redoStack.current = [];
      lastPush.current = now;
      setCanUndo(true);
      setCanRedo(false);
    }
  }

  function undo() {
    const previous = undoStack.current.pop();
    if (previous === undefined) return;
    redoStack.current.push(essay);
    setEssay(previous);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  }

  function redo() {
    const next = redoStack.current.pop();
    if (next === undefined) return;
    undoStack.current.push(essay);
    setEssay(next);
    setCanRedo(redoStack.current.length > 0);
    setCanUndo(true);
  }

  async function cut() {
    const field = composer.current;
    if (!field) return;
    const { selectionStart, selectionEnd } = field;
    if (selectionStart === selectionEnd) return;
    const selected = essay.slice(selectionStart, selectionEnd);
    try {
      await navigator.clipboard.writeText(selected);
    } catch {
      // Clipboard permission denied. The text is still removed.
    }
    undoStack.current.push(essay);
    setCanUndo(true);
    setEssay(essay.slice(0, selectionStart) + essay.slice(selectionEnd));
    field.focus();
  }

  async function paste() {
    const field = composer.current;
    if (!field) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const { selectionStart, selectionEnd } = field;
      undoStack.current.push(essay);
      setCanUndo(true);
      setEssay(essay.slice(0, selectionStart) + text + essay.slice(selectionEnd));
      field.focus();
    } catch {
      // Reading the clipboard needs permission; ignore a refusal.
    }
  }

  const words = countWords(essay);
  const hasSelection =
    composer.current != null && composer.current.selectionStart !== composer.current.selectionEnd;

  if (loading) {
    return (
      <>
        <AppBar contextTitle="Loading" />
        <div className="gre-page gre-muted">Fetching a prompt...</div>
      </>
    );
  }

  if (!topic) {
    return (
      <>
        <AppBar contextTitle="No topics" />
        <div className="gre-page">No topics were found. Has the database been seeded?</div>
      </>
    );
  }

  return (
    <>
      <AppBar
        contextTitle={
          revisionOf
            ? `Issue ${String(topic.id).padStart(2, '0')} · Revision ${revisionNumber}`
            : `Issue ${String(topic.id).padStart(2, '0')}`
        }
        actions={
          <>
            <Link href="/" className="gre-btn">
              Home
            </Link>
            <button
              className="gre-btn gre-btn-primary"
              onClick={() => submit(false)}
              disabled={submitting || words < 25}
              title={words < 25 ? 'Write at least 25 words' : 'Submit for scoring'}
            >
              {submitting ? 'Scoring...' : 'Submit'}
            </button>
          </>
        }
        contextRight={
          revisionOf ? (
            <span className="gre-small">Untimed. Fix what the feedback flagged.</span>
          ) : (
            <>
              {showTime && (
                <span className={`gre-timer ${secondsLeft <= 300 ? 'gre-timer-low' : ''}`}>
                  {formatDuration(secondsLeft)}
                </span>
              )}
              <button className="gre-timer-toggle" onClick={() => setShowTime((v) => !v)}>
                <span aria-hidden="true">{showTime ? '⊖' : '⊕'}</span>
                {showTime ? 'Hide Time' : 'Show Time'}
              </button>
            </>
          )
        }
      />

      <div className="gre-split">
        <div className="gre-pane-left">
          <div className="gre-prose">
            <p>{topic.statement}</p>
            <p>{topic.taskInstruction}</p>
          </div>

          {revisionOf && (failedChecks.length > 0 || weakTraits.length > 0) && (
            <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--rule-soft)' }}>
              <h3 style={{ fontSize: '1rem', margin: '0 0 0.6rem' }}>Fix in this revision</h3>
              {failedChecks.map((check) => (
                <div key={check.id} className="gre-improve-item">
                  <div className="gre-improve-head">
                    <span className="gre-improve-mark gre-fail">✕</span>
                    <span>{check.label}</span>
                  </div>
                  <div className="gre-small gre-muted" style={{ marginLeft: '1.5rem' }}>
                    {check.detail}
                  </div>
                </div>
              ))}
              {weakTraits.length > 0 && (
                <p className="gre-small gre-muted" style={{ marginBottom: 0 }}>
                  Weakest traits last time:{' '}
                  {weakTraits.map((trait) => `${trait.label} ${trait.score}`).join(', ')}.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="gre-pane-right">
          <div className="gre-toolbar">
            <button className="gre-btn-toolbar" onClick={cut} disabled={!hasSelection}>
              Cut
            </button>
            <button className="gre-btn-toolbar" onClick={paste}>
              Paste
            </button>
            <button className="gre-btn-toolbar" onClick={undo} disabled={!canUndo}>
              Undo
            </button>
            <button className="gre-btn-toolbar" onClick={redo} disabled={!canRedo}>
              Redo
            </button>
            <span className="gre-toolbar-spacer" />
            {showWordCount && <span className="gre-toolbar-count">{words} words</span>}
            <button
              className="gre-btn-toolbar"
              onClick={() => {
                const next = !showWordCount;
                setShowWordCount(next);
                setPreference('wordCount', next);
              }}
            >
              {showWordCount ? 'Hide word count' : 'Show word count'}
            </button>
            <button className="gre-btn-toolbar" onClick={() => submit(true)} disabled={submitting || !essay.trim()}>
              Save for later
            </button>
          </div>

          <textarea
            ref={composer}
            className="gre-composer"
            value={essay}
            onChange={(event) => {
              pushUndo(essay);
              setEssay(event.target.value);
            }}
            spellCheck={false}
            aria-label="Your response"
            placeholder="Take a position in your first paragraph, then defend it. Leave a blank line between paragraphs."
          />
        </div>
      </div>
    </>
  );
}
