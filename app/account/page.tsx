'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppBar from '@/components/AppBar';
import { getSyncCode, setSyncCode } from '@/lib/session';

export default function AccountPage() {
  const [code, setCode] = useState('');
  const [entered, setEntered] = useState('');
  const [name, setName] = useState('');
  const [testDate, setTestDate] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const current = getSyncCode();
    setCode(current);
    fetch(`/api/summary?syncCode=${encodeURIComponent(current)}`)
      .then((r) => r.json())
      .then((data) => {
        setName(data.displayName ?? '');
        setTestDate(data.testDate ?? '');
      })
      .catch(() => undefined);
  }, []);

  async function saveProfile() {
    setSaving(true);
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncCode: code, displayName: name || null, testDate: testDate || null }),
      });
      setMessage('Saved.');
    } finally {
      setSaving(false);
    }
  }

  function switchCode() {
    const trimmed = entered.trim().toLowerCase();
    if (!/^[a-z0-9-]{8,64}$/.test(trimmed)) {
      setMessage('That does not look like a sync code. They look like amber-cedar-1234.');
      return;
    }
    setCode(setSyncCode(trimmed));
    setEntered('');
    setMessage('Done. This device now shares that history. Reload to see it.');
  }

  return (
    <>
      <AppBar
        contextTitle="Account"
        actions={
          <Link href="/" className="gre-btn">
            Home
          </Link>
        }
      />

      <div className="gre-page">
        <div className="gre-columns" style={{ borderTop: 'none', paddingTop: 0 }}>
          <section>
            <h2 className="gre-col-title">Your details</h2>

            <label className="gre-small" htmlFor="name" style={{ display: 'block', fontWeight: 600 }}>
              Name
            </label>
            <input
              id="name"
              className="gre-field"
              style={{ width: '100%', maxWidth: '20rem', marginBottom: '1rem' }}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Shown on the dashboard"
            />

            <label className="gre-small" htmlFor="testDate" style={{ display: 'block', fontWeight: 600 }}>
              Test date
            </label>
            <input
              id="testDate"
              type="date"
              className="gre-field"
              style={{ width: '100%', maxWidth: '20rem', marginBottom: '1rem' }}
              value={testDate}
              onChange={(event) => setTestDate(event.target.value)}
            />

            <div>
              <button className="gre-btn gre-btn-primary" onClick={saveProfile} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
            {message && (
              <p className="gre-small" style={{ marginTop: '0.75rem' }}>
                {message}
              </p>
            )}
          </section>

          <section>
            <h2 className="gre-col-title">Sync code</h2>
            <p className="gre-small gre-muted">
              Type this on another device to see the same essays and progress there. There is no
              account and no password, so anyone with this code can read your history.
            </p>
            <div className="gre-code" style={{ marginBottom: '1.25rem' }}>
              {code || '...'}
            </div>

            <label className="gre-small" htmlFor="switch" style={{ display: 'block', fontWeight: 600 }}>
              Use a different code
            </label>
            <div className="gre-row">
              <input
                id="switch"
                className="gre-field"
                style={{ minWidth: '15rem' }}
                value={entered}
                onChange={(event) => setEntered(event.target.value)}
                placeholder="amber-cedar-1234"
              />
              <button className="gre-btn" onClick={switchCode}>
                Switch
              </button>
            </div>
          </section>
        </div>

        <section style={{ marginTop: '2.5rem', borderTop: '1px solid var(--rule-soft)', paddingTop: '1.5rem' }}>
          <h2 className="gre-col-title">How scoring works</h2>
          <p className="gre-small" style={{ maxWidth: '46rem' }}>
            Every essay is scored by a rubric engine fitted on thousands of human-scored essays and
            anchored to essays ETS scored itself. It measures structure, development, sentence
            variety and mechanics. It cannot tell a well-reasoned argument from a fluent empty one,
            which is why the grade comes with a range and why the AI review exists separately.
          </p>
          <p className="gre-tiny gre-muted" style={{ maxWidth: '46rem' }}>
            Topics, the scoring guide and the scored sample essays are published by ETS and belong to
            ETS. This is an independent study tool and is not affiliated with or endorsed by ETS.
          </p>
        </section>
      </div>
    </>
  );
}
