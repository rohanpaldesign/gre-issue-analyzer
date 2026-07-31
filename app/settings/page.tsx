'use client';

import { useEffect, useState } from 'react';
import { getSyncCode, setSyncCode } from '@/lib/session';

export default function SettingsPage() {
  const [code, setCode] = useState('');
  const [entered, setEntered] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setCode(getSyncCode()), []);

  function apply() {
    const trimmed = entered.trim().toLowerCase();
    if (!/^[a-z0-9-]{8,64}$/.test(trimmed)) {
      setMessage('That does not look like a sync code. They look like amber-cedar-1234.');
      return;
    }
    setCode(setSyncCode(trimmed));
    setEntered('');
    setMessage('Done. This device now shares that history.');
  }

  return (
    <div className="lp-stack">
      <h1>Settings</h1>

      <section className="lp-card">
        <h2>Your sync code</h2>
        <p className="lp-small lp-muted">
          Type this on another device to see the same essays and progress there. There is no account
          and no password, so anyone with this code can read your history. Keep it to yourself.
        </p>
        <div
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: '1.35rem',
            padding: '0.75rem 1rem',
            background: 'var(--md-sys-color-surface-container-high)',
            borderRadius: 'var(--md-sys-shape-corner-medium)',
            wordBreak: 'break-all',
          }}
        >
          {code || '...'}
        </div>
      </section>

      <section className="lp-card">
        <h2>Use a different code</h2>
        <p className="lp-small lp-muted">
          Entering a code from another device pulls that history onto this one. Essays already written
          under the current code stay where they are, and you can switch back by retyping it.
        </p>
        <div className="lp-row">
          <input
            className="lp-field"
            style={{ maxWidth: '20rem' }}
            value={entered}
            onChange={(event) => setEntered(event.target.value)}
            placeholder="amber-cedar-1234"
            aria-label="Sync code"
          />
          <button className="lp-btn" onClick={apply}>
            Use this code
          </button>
        </div>
        {message && (
          <p className="lp-small" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
            {message}
          </p>
        )}
      </section>

      <section className="lp-card">
        <h2>How scoring works</h2>
        <p className="lp-small">
          Every essay is scored by a rubric engine fitted on thousands of human-scored essays and
          anchored to essays ETS scored itself. It measures structure, development, sentence variety
          and mechanics.
        </p>
        <p className="lp-small">
          What it cannot do is tell a well-reasoned argument from a fluent empty one. That is why the
          score is shown as a range rather than a single number, and why the optional AI review exists.
          The AI review sends your essay to Google Gemini; free tier prompts may be used for training,
          so it is not private.
        </p>
        <p className="lp-small lp-muted" style={{ marginBottom: 0 }}>
          Topics, the scoring guide and the scored sample essays are published by ETS and belong to
          ETS. This is an independent study tool and is not affiliated with or endorsed by ETS.
        </p>
      </section>
    </div>
  );
}
