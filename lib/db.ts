// Turso access for the app.
//
// Speaks the libSQL HTTP pipeline API over fetch rather than pulling in a
// client library. The scripts already do this and it removes a dependency from
// the serverless bundle, which matters because this project cannot be built
// locally: fewer moving parts means fewer ways for a deploy to fail.

type Primitive = string | number | boolean | null | undefined;

type Arg =
  | { type: 'null' }
  | { type: 'integer'; value: string }
  | { type: 'float'; value: number }
  | { type: 'text'; value: string };

export type Row = Record<string, string | number | null>;

function toArg(value: Primitive): Arg {
  if (value === null || value === undefined) return { type: 'null' };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { type: 'integer', value: String(value) }
      : { type: 'float', value };
  }
  if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' };
  return { type: 'text', value: String(value) };
}

function fromCell(cell: { type: string; value?: string | number }): string | number | null {
  if (!cell || cell.type === 'null') return null;
  if (cell.type === 'integer') return Number.parseInt(String(cell.value), 10);
  if (cell.type === 'float') return Number(cell.value);
  return String(cell.value);
}

function endpoint(): { url: string; token: string } {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url || !token) throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set.');
  return { url: `${url.replace(/^libsql:/, 'https:').replace(/\/$/, '')}/v2/pipeline`, token };
}

export async function pipeline(
  statements: Array<[string, Primitive[]] | string>
): Promise<Array<{ rows: Row[]; rowsAffected: number }>> {
  const { url, token } = endpoint();

  const requests: unknown[] = statements.map((statement) => {
    const [sql, args = []] = Array.isArray(statement) ? statement : [statement, []];
    return { type: 'execute', stmt: { sql, args: args.map(toArg) } };
  });
  requests.push({ type: 'close' });

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Database request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    results?: Array<{
      type: string;
      error?: { message: string };
      response?: { type: string; result: { cols: Array<{ name: string }>; rows: Array<Array<{ type: string; value?: string | number }>>; affected_row_count?: number } };
    }>;
  };

  const out: Array<{ rows: Row[]; rowsAffected: number }> = [];
  for (const entry of payload.results ?? []) {
    if (entry.type === 'error') throw new Error(entry.error?.message ?? 'Unknown database error');
    if (entry.response?.type !== 'execute') continue;
    const result = entry.response.result;
    out.push({
      rows: result.rows.map((row) =>
        Object.fromEntries(row.map((cell, i) => [result.cols[i].name, fromCell(cell)]))
      ),
      rowsAffected: result.affected_row_count ?? 0,
    });
  }
  return out;
}

export async function query<T = Row>(sql: string, args: Primitive[] = []): Promise<T[]> {
  const [result] = await pipeline([[sql, args]]);
  return (result?.rows ?? []) as T[];
}

export async function execute(sql: string, args: Primitive[] = []): Promise<number> {
  const [result] = await pipeline([[sql, args]]);
  return result?.rowsAffected ?? 0;
}

/**
 * Resolve a sync code to a user, creating the user on first sight.
 *
 * Identity here is deliberately thin. There is no password and no auth
 * provider: a code is generated on the first device and typed into the second.
 * Only its hash is stored, so the database never holds the code itself.
 */
export async function resolveUser(syncCode: string): Promise<string> {
  const normalised = syncCode.trim().toLowerCase();
  if (!/^[a-z0-9-]{8,64}$/.test(normalised)) throw new Error('That sync code is not valid.');

  const hash = await hashCode(normalised);
  const existing = await query<{ id: string }>('SELECT id FROM users WHERE sync_code_hash = ?', [hash]);
  if (existing.length > 0) return existing[0].id;

  const id = crypto.randomUUID();
  await execute('INSERT INTO users (id, sync_code_hash) VALUES (?, ?)', [id, hash]);
  return id;
}

async function hashCode(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`gre-issue-analyzer:${value}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Human-friendly sync code: three short words plus digits, easy to retype. */
export function generateSyncCode(): string {
  const words = [
    'amber', 'basalt', 'cedar', 'delta', 'ember', 'fjord', 'gable', 'harbor', 'ivory',
    'jasper', 'kelp', 'linen', 'marble', 'nimbus', 'onyx', 'pewter', 'quartz', 'reed',
    'slate', 'thistle', 'umber', 'verdant', 'willow', 'yarrow',
  ];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  const digits = Math.floor(Math.random() * 9000) + 1000;
  return `${pick()}-${pick()}-${digits}`;
}
