'use client';

import { useEffect, useMemo, useState } from 'react';
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
    for (const topic of topics ?? []) for (const t of topic.themes) all.add(t);
    return [...all].sort();
  }, [topics]);

  const filtered = (topics ?? []).filter(
    (topic) =>
      (!theme || topic.themes.includes(theme)) &&
      (!taskType || topic.taskType === taskType) &&
      (!unattemptedOnly || topic.attempts === 0)
  );

  if (!topics) return <p className="lp-muted">Loading the pool...</p>;

  const attempted = topics.filter((t) => t.attempts > 0).length;

  return (
    <div className="lp-stack">
      <div>
        <h1>The pool</h1>
        <p className="lp-small lp-muted">
          All {topics.length} official ETS Issue topics. {attempted} attempted.
        </p>
      </div>

      <div className="lp-card">
        <div className="lp-row" style={{ marginBottom: '0.6rem' }}>
          <button className="lp-chip" aria-pressed={unattemptedOnly} onClick={() => setUnattemptedOnly((v) => !v)}>
            Not yet attempted
          </button>
          {TASK_TYPES.map(([value, label]) => (
            <button
              key={value}
              className="lp-chip"
              aria-pressed={taskType === value}
              onClick={() => setTaskType(taskType === value ? null : value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="lp-row">
          {themes.map((value) => (
            <button
              key={value}
              className="lp-chip"
              aria-pressed={theme === value}
              onClick={() => setTheme(theme === value ? null : value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <p className="lp-small lp-muted">{filtered.length} topics</p>

      {filtered.map((topic) => (
        <div className="lp-card" key={topic.id} style={{ marginBottom: '0.6rem' }}>
          <div className="lp-tiny lp-muted">
            {topic.id} · {topic.themes.join(', ')}
            {topic.attempts > 0 && ` · attempted ${topic.attempts} time${topic.attempts === 1 ? '' : 's'}`}
          </div>
          <div style={{ marginTop: '0.3rem' }}>{topic.statement}</div>
        </div>
      ))}
    </div>
  );
}
