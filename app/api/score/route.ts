import { NextResponse } from 'next/server';
// @ts-expect-error the scoring engine is plain JS with JSDoc types
import { scoreEssay } from '@/lib/scoring/index.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Scoring loads a 370,000 word dictionary and does real work on long essays.
export const maxDuration = 30;

/** Score an essay against the ETS rubric and the GregMat structure. */
export async function POST(request: Request) {
  let body: { essay?: string; topic?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON.' }, { status: 400 });
  }

  const essay = typeof body.essay === 'string' ? body.essay : '';
  if (!essay.trim()) {
    return NextResponse.json({ error: 'No essay supplied.' }, { status: 400 });
  }
  if (essay.length > 60000) {
    return NextResponse.json({ error: 'That essay is too long to score.' }, { status: 413 });
  }

  try {
    return NextResponse.json(scoreEssay(essay, body.topic ?? null));
  } catch (error) {
    console.error('scoring failed', error);
    return NextResponse.json({ error: 'Scoring failed.' }, { status: 500 });
  }
}
