import { NextResponse } from 'next/server';
import { execute, pipeline, query, resolveUser } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Essay history and progress for one sync code. */
export async function GET(request: Request) {
  const syncCode = new URL(request.url).searchParams.get('syncCode');
  if (!syncCode) return NextResponse.json({ error: 'A sync code is required.' }, { status: 400 });

  let userId: string;
  try {
    userId = await resolveUser(syncCode);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const essays = await query(
    `SELECT e.id, e.topic_id, e.stance, e.word_count, e.seconds_used, e.timed, e.assisted, e.saved,
            e.created_at, t.statement, t.task_type,
            s.holistic, s.position, s.development, s.organization, s.language, s.conventions
     FROM essays e
     JOIN topics t ON t.id = e.topic_id
     LEFT JOIN essay_scores s ON s.essay_id = e.id AND s.source = 'heuristic'
     WHERE e.user_id = ?
     ORDER BY e.created_at DESC`,
    [userId]
  );

  const [coverage] = await pipeline([
    [
      `SELECT COUNT(DISTINCT topic_id) AS attempted,
              (SELECT COUNT(*) FROM topics) AS total
       FROM essays WHERE user_id = ?`,
      [userId],
    ],
  ]);

  return NextResponse.json({
    userId,
    essays: essays.map((e) => ({
      id: e.id,
      topicId: e.topic_id,
      statement: e.statement,
      taskType: e.task_type,
      stance: e.stance,
      wordCount: e.word_count,
      secondsUsed: e.seconds_used,
      timed: Boolean(e.timed),
      assisted: Boolean(e.assisted),
      saved: Boolean(e.saved),
      createdAt: e.created_at,
      scores: e.holistic === null ? null : {
        holistic: e.holistic,
        position: e.position,
        development: e.development,
        organization: e.organization,
        language: e.language,
        conventions: e.conventions,
      },
    })),
    coverage: coverage.rows[0],
  });
}

/** Save a submitted essay together with its heuristic scores. */
export async function POST(request: Request) {
  let body: {
    syncCode?: string;
    topicId?: number;
    essay?: string;
    stance?: string;
    secondsUsed?: number;
    timed?: boolean;
    saved?: boolean;
    assisted?: boolean;
    scores?: { holistic: number; traits: Array<{ key: string; score: number }> } | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON.' }, { status: 400 });
  }

  if (!body.syncCode || !body.topicId || !body.essay?.trim()) {
    return NextResponse.json({ error: 'syncCode, topicId and essay are all required.' }, { status: 400 });
  }

  let userId: string;
  try {
    userId = await resolveUser(body.syncCode);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const wordCount = body.essay.trim().split(/\s+/).filter(Boolean).length;

  await execute(
    `INSERT INTO essays (id, user_id, topic_id, stance, body, word_count, seconds_used, timed, assisted, saved)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      body.topicId,
      body.stance ?? null,
      body.essay,
      wordCount,
      Math.round(body.secondsUsed ?? 0),
      body.timed === false ? 0 : 1,
      body.assisted ? 1 : 0,
      body.saved ? 1 : 0,
    ]
  );

  if (body.scores) {
    const trait = (key: string) => body.scores?.traits.find((t) => t.key === key)?.score ?? 0;
    await execute(
      `INSERT INTO essay_scores (essay_id, source, holistic, position, development, organization, language, conventions, payload)
       VALUES (?, 'heuristic', ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.scores.holistic,
        trait('position'),
        trait('development'),
        trait('organization'),
        trait('language'),
        trait('conventions'),
        JSON.stringify({ full: body.scores }),
      ]
    );
  }

  return NextResponse.json({ id, userId, wordCount });
}
