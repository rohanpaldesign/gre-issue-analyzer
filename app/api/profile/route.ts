import { NextResponse } from 'next/server';
import { execute, resolveUser } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Save the display name and test date behind a sync code. */
export async function POST(request: Request) {
  let body: { syncCode?: string; displayName?: string | null; testDate?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON.' }, { status: 400 });
  }

  if (!body.syncCode) return NextResponse.json({ error: 'A sync code is required.' }, { status: 400 });

  const testDate = body.testDate ?? null;
  if (testDate && !/^\d{4}-\d{2}-\d{2}$/.test(testDate)) {
    return NextResponse.json({ error: 'Test date must be YYYY-MM-DD.' }, { status: 400 });
  }

  const displayName = (body.displayName ?? '').trim().slice(0, 60) || null;

  let userId: string;
  try {
    userId = await resolveUser(body.syncCode);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  await execute('UPDATE users SET display_name = ?, test_date = ? WHERE id = ?', [
    displayName,
    testDate,
    userId,
  ]);

  return NextResponse.json({ ok: true, displayName, testDate });
}
