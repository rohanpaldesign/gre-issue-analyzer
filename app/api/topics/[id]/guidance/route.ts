import { NextResponse } from 'next/server';
import { pipeline } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Both sides of a topic: supporting reasons, opposing reasons, the strongest
 * concession for each side with its rebuttal, and the reusable examples worth
 * preparing.
 *
 * The writing view deliberately does not fetch this until after submission.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const topicId = Number.parseInt(params.id, 10);
  if (!Number.isInteger(topicId)) {
    return NextResponse.json({ error: 'Invalid topic id.' }, { status: 400 });
  }

  const [topics, reasons, concessions, examples, modelEssays] = await pipeline([
    ['SELECT * FROM topics WHERE id = ?', [topicId]],
    ['SELECT side, ord, claim, mechanism, example_slug FROM topic_reasons WHERE topic_id = ? ORDER BY side, ord', [topicId]],
    ['SELECT side, concession, rebuttal FROM topic_concessions WHERE topic_id = ?', [topicId]],
    [
      `SELECT e.slug, e.title, e.domain, e.summary, e.key_facts, e.moves, x.relevance
       FROM topic_examples x JOIN examples e ON e.slug = x.example_slug
       WHERE x.topic_id = ? ORDER BY e.title`,
      [topicId],
    ],
    [
      `SELECT side, intro, support_1, support_2, concession, conclusion, word_count
       FROM model_essays WHERE topic_id = ?`,
      [topicId],
    ],
  ]);

  if (topics.rows.length === 0) {
    return NextResponse.json({ error: 'No such topic.' }, { status: 404 });
  }

  const topic = topics.rows[0];
  const bySide = (side: string) =>
    reasons.rows
      .filter((r) => r.side === side)
      .map((r) => ({
        claim: r.claim,
        mechanism: r.mechanism,
        exampleSlug: r.example_slug,
      }));

  return NextResponse.json({
    topic: {
      id: topic.id,
      statement: topic.statement,
      taskInstruction: topic.task_instruction,
      taskType: topic.task_type,
      claim: topic.claim,
      reason: topic.reason,
      themes: JSON.parse(String(topic.themes ?? '[]')),
    },
    support: bySide('support'),
    oppose: bySide('oppose'),
    concessions: Object.fromEntries(
      concessions.rows.map((c) => [c.side, { concession: c.concession, rebuttal: c.rebuttal }])
    ),
    // Worked responses, keyed by stance. Absent until authored, and the
    // interface falls back to the reason list when a topic has none yet.
    modelEssays: Object.fromEntries(
      modelEssays.rows.map((row) => [
        row.side,
        {
          intro: row.intro,
          support1: row.support_1,
          support2: row.support_2,
          concession: row.concession,
          conclusion: row.conclusion,
          wordCount: row.word_count,
        },
      ])
    ),
    examples: examples.rows.map((e) => ({
      slug: e.slug,
      title: e.title,
      domain: e.domain,
      summary: e.summary,
      keyFacts: JSON.parse(String(e.key_facts ?? '[]')),
      moves: JSON.parse(String(e.moves ?? '[]')),
      relevance: e.relevance,
    })),
  });
}
