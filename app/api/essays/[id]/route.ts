import { NextResponse } from 'next/server';
import { execute, pipeline, resolveUser } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One essay with its topic and stored scores, scoped to the owner. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const syncCode = new URL(request.url).searchParams.get('syncCode');
  if (!syncCode) return NextResponse.json({ error: 'A sync code is required.' }, { status: 400 });

  let userId: string;
  try {
    userId = await resolveUser(syncCode);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const [essays] = await pipeline([
    [
      `SELECT e.id, e.topic_id, e.body, e.saved, e.created_at, e.word_count, e.seconds_used,
              t.statement, t.task_instruction, t.task_type,
              s.holistic, s.payload
       FROM essays e
       JOIN topics t ON t.id = e.topic_id
       LEFT JOIN essay_scores s ON s.essay_id = e.id AND s.source = 'heuristic'
       WHERE e.id = ? AND e.user_id = ?`,
      [params.id, userId],
    ],
  ]);

  if (essays.rows.length === 0) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const row = essays.rows[0];
  // The full score object is stored in the payload so the result page can show
  // exactly what was reported at submission time, rather than rescoring later
  // against possibly different weights.
  let score = null;
  if (row.payload) {
    try {
      score = JSON.parse(String(row.payload)).full ?? null;
    } catch {
      score = null;
    }
  }

  return NextResponse.json({
    id: row.id,
    topicId: row.topic_id,
    essay: row.body,
    saved: Boolean(row.saved),
    createdAt: row.created_at,
    wordCount: row.word_count,
    secondsUsed: row.seconds_used,
    topic: {
      id: row.topic_id,
      statement: row.statement,
      taskInstruction: row.task_instruction,
      taskType: row.task_type,
    },
    score,
  });
}

/** Mark an essay saved or unsaved. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let body: { syncCode?: string; saved?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON.' }, { status: 400 });
  }

  if (!body.syncCode) return NextResponse.json({ error: 'A sync code is required.' }, { status: 400 });

  let userId: string;
  try {
    userId = await resolveUser(body.syncCode);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const changed = await execute('UPDATE essays SET saved = ? WHERE id = ? AND user_id = ?', [
    body.saved ? 1 : 0,
    params.id,
    userId,
  ]);

  if (changed === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, saved: Boolean(body.saved) });
}
