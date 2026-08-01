import { NextResponse } from 'next/server';
import { pipeline, resolveUser } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADVICE: Record<string, string> = {
  position:
    'Say which side you are on in the first paragraph and qualify it with "largely" rather than claiming it always holds.',
  development:
    'Each body paragraph needs a reason and a concrete named example, then an explanation of why that example proves the point.',
  organization:
    'Aim for the five paragraph shape and make sure the concession paragraph actually rebuts what it concedes.',
  language:
    'Vary sentence length deliberately and cut filler like "very" and "really" in favour of precise verbs.',
  conventions:
    'Leave two minutes to reread. Most flagged errors are typos and comma splices you would catch on a second pass.',
};

const LABELS: Record<string, string> = {
  position: 'Position and task response',
  development: 'Development',
  organization: 'Focus and organisation',
  language: 'Language and fluency',
  conventions: 'Conventions',
};

/** Everything the dashboard needs, in one request. */
export async function GET(request: Request) {
  const syncCode = new URL(request.url).searchParams.get('syncCode');
  if (!syncCode) return NextResponse.json({ error: 'A sync code is required.' }, { status: 400 });

  let userId: string;
  try {
    userId = await resolveUser(syncCode);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const [profile, counts, scores] = await pipeline([
    ['SELECT display_name, test_date FROM users WHERE id = ?', [userId]],
    [
      `SELECT (SELECT COUNT(DISTINCT topic_id) FROM essays WHERE user_id = ?) AS attempted,
              (SELECT COUNT(*) FROM topics) AS total`,
      [userId],
    ],
    // Assisted attempts are excluded: the writer read the arguments first, so
    // the score does not measure what they can do unaided.
    [
      `SELECT s.holistic, s.position, s.development, s.organization, s.language, s.conventions
       FROM essays e JOIN essay_scores s ON s.essay_id = e.id AND s.source = 'heuristic'
       WHERE e.user_id = ? AND e.assisted = 0
       ORDER BY e.created_at DESC`,
      [userId],
    ],
  ]);

  const rows = scores.rows as Array<Record<string, number>>;
  const recent = rows.slice(0, 5).map((row) => row.holistic);
  const expectedGrade =
    recent.length > 0
      ? Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 2) / 2
      : null;

  const weakest = Object.keys(LABELS)
    .map((key) => ({
      key,
      label: LABELS[key],
      mean: rows.length > 0 ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : 0,
      advice: ADVICE[key],
    }))
    .sort((a, b) => a.mean - b.mean)
    .slice(0, 3);

  return NextResponse.json({
    displayName: profile.rows[0]?.display_name ?? null,
    testDate: profile.rows[0]?.test_date ?? null,
    expectedGrade,
    attempted: Number(counts.rows[0]?.attempted ?? 0),
    total: Number(counts.rows[0]?.total ?? 0),
    essayCount: rows.length,
    weakest: rows.length > 0 ? weakest : [],
  });
}
