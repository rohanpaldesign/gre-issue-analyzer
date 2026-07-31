import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * List topics, or pick one.
 *
 * ?mode=random    a topic the user has not attempted, if a user is given
 * ?theme=         filter by theme
 * ?taskType=      filter by task type
 * ?userId=        used to exclude attempted topics and mark coverage
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode');
  const theme = url.searchParams.get('theme');
  const taskType = url.searchParams.get('taskType');
  const userId = url.searchParams.get('userId');

  const filters: string[] = [];
  const args: Array<string | number> = [];

  if (theme) {
    filters.push('themes LIKE ?');
    args.push(`%"${theme}"%`);
  }
  if (taskType) {
    filters.push('task_type = ?');
    args.push(taskType);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  if (mode === 'random') {
    // Prefer something never attempted, so practice covers the pool rather
    // than circling the same handful of prompts.
    if (userId) {
      const unattempted = await query(
        `SELECT * FROM topics ${where}${where ? ' AND' : 'WHERE'} id NOT IN
           (SELECT topic_id FROM essays WHERE user_id = ?)
         ORDER BY RANDOM() LIMIT 1`,
        [...args, userId]
      );
      if (unattempted.length > 0) return NextResponse.json({ topic: shape(unattempted[0]) });
    }
    const any = await query(`SELECT * FROM topics ${where} ORDER BY RANDOM() LIMIT 1`, args);
    return NextResponse.json({ topic: any.length > 0 ? shape(any[0]) : null });
  }

  const topics = await query(
    `SELECT t.*,
            (SELECT COUNT(*) FROM essays e WHERE e.topic_id = t.id AND e.user_id = ?) AS attempts
     FROM topics t ${where} ORDER BY t.id`,
    [userId ?? '', ...args]
  );

  return NextResponse.json({ topics: topics.map(shape) });
}

function shape(row: Record<string, unknown>) {
  return {
    id: row.id,
    statement: row.statement,
    taskInstruction: row.task_instruction,
    taskType: row.task_type,
    claim: row.claim,
    reason: row.reason,
    themes: JSON.parse(String(row.themes ?? '[]')),
    attempts: Number(row.attempts ?? 0),
  };
}
