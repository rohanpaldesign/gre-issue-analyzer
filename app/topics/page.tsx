'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import AppBar from '@/components/AppBar';
import { getSyncCode } from '@/lib/session';

type Topic = {
  id: number;
  statement: string;
  taskType: string;
  themes: string[];
  attempts: number;
};

const TASK_TYPES = [
  ['statement', 'Statement'],
  ['claim', 'Claim'],
  ['claim-reason', 'Claim and reason'],
  ['recommendation', 'Recommendation'],
  ['two-views', 'Two views'],
  ['policy', 'Policy'],
] as const;

export default function TopicsPage() {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const [taskType, setTaskType] = useState<string | null>(null);
  const [unattemptedOnly, setUnattemptedOnly] = useState(false);

  useEffect(() => {
    fetch(`/api/topics?userId=${encodeURIComponent(getSyncCode())}`)
      .then((r) => r.json())
      .then((data) => setTopics(data.topics ?? []))
      .catch(() => setTopics([]));
  }, []);

  const themes = useMemo(() => {
    const all = new Set<string>();
    for (const topic of topics ?? []) for (const value of topic.themes) all.add(value);
    return [...all].sort();
  }, [topics]);

  const filtered = (topics ?? []).filter(
    (topic) =>
      (!theme || topic.themes.includes(theme)) &&
      (!taskType || topic.taskType === taskType) &&
      (!unattemptedOnly || topic.attempts === 0)
  );

  const attempted = (topics ?? []).filter((topic) => topic.attempts > 0).length;

  return (
    <>
      <AppBar
        contextTitle={topics ? `Issue pool · ${attempted} of ${topics.length} attempted` : 'Issue pool'}
        actions={
          <>
            <Link href="/" className="gre-btn">
              Home
            </Link>
            <Link href="/write" className="gre-btn gre-btn-primary">
              Start a new issue
            </Link>
          </>
        }
      />

      <div className="gre-page">
        {!topics && <p className="gre-muted">Loading the pool...</p>}

        {topics && (
          <>
            <div className="gre-row" style={{ marginBottom: '0.6rem' }}>
              <button
                className="gre-chip"
                aria-pressed={unattemptedOnly}
                onClick={() => setUnattemptedOnly((value) => !value)}
              >
                Not yet attempted
              </button>
              {TASK_TYPES.map(([value, label]) => (
                <button
                  key={value}
                  className="gre-chip"
                  aria-pressed={taskType === value}
                  onClick={() => setTaskType(taskType === value ? null : value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="gre-row" style={{ marginBottom: '1.5rem' }}>
              {themes.map((value) => (
                <button
                  key={value}
                  className="gre-chip"
                  aria-pressed={theme === value}
                  onClick={() => setTheme(theme === value ? null : value)}
                >
                  {value}
                </button>
              ))}
            </div>

            <p className="gre-small gre-muted">{filtered.length} topics</p>

            {filtered.map((topic) => (
              <div className="gre-block" key={topic.id}>
                <div className="gre-block-label">
                  Issue {String(topic.id).padStart(2, '0')} · {topic.themes.join(', ')}
                  {topic.attempts > 0 &&
                    ` · attempted ${topic.attempts} time${topic.attempts === 1 ? '' : 's'}`}
                </div>
                <div className="gre-block-body">{topic.statement}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
