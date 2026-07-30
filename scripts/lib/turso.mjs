// Dependency-free Turso client for the migrate, seed, and calibration scripts.
//
// The app itself uses @libsql/client, but these scripts run before (and
// sometimes without) an install, so they speak the libSQL HTTP pipeline API
// directly over fetch.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Load .env.local without pulling in dotenv. */
export async function loadEnv(cwd = process.cwd()) {
  const merged = { ...process.env };
  for (const file of ['.env.local', '.env']) {
    let contents;
    try {
      contents = await readFile(path.join(cwd, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (merged[key] === undefined) merged[key] = value;
    }
  }
  return merged;
}

function toArg(value) {
  if (value === null || value === undefined) return { type: 'null' };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { type: 'integer', value: String(value) }
      : { type: 'float', value };
  }
  if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' };
  return { type: 'text', value: String(value) };
}

function fromValue(cell) {
  if (!cell || cell.type === 'null') return null;
  if (cell.type === 'integer') return Number.parseInt(cell.value, 10);
  if (cell.type === 'float') return Number(cell.value);
  return cell.value;
}

export function createClient(env) {
  const rawUrl = env.TURSO_DATABASE_URL;
  const token = env.TURSO_AUTH_TOKEN;
  if (!rawUrl || !token) {
    throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set. Run `vercel env pull .env.local`.');
  }
  const endpoint = `${rawUrl.replace(/^libsql:/, 'https:').replace(/\/$/, '')}/v2/pipeline`;

  /**
   * Send a batch of statements down one pipeline. Statements run in order and
   * share a connection, so this is also how transactions are expressed.
   */
  async function pipeline(statements) {
    const requests = statements.map((statement) => {
      const [sql, args = []] = Array.isArray(statement) ? statement : [statement, []];
      return { type: 'execute', stmt: { sql, args: args.map(toArg) } };
    });
    requests.push({ type: 'close' });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      throw new Error(`Turso HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const payload = await response.json();
    const results = [];
    for (const [index, entry] of (payload.results ?? []).entries()) {
      if (entry.type === 'error') {
        const sql = Array.isArray(statements[index]) ? statements[index][0] : statements[index];
        throw new Error(`SQL failed: ${entry.error?.message}\n  statement: ${String(sql).slice(0, 200)}`);
      }
      if (entry.response?.type !== 'execute') continue;
      const result = entry.response.result;
      results.push({
        columns: result.cols.map((c) => c.name),
        rows: result.rows.map((row) =>
          Object.fromEntries(row.map((cell, i) => [result.cols[i].name, fromValue(cell)]))
        ),
        rowsAffected: result.affected_row_count ?? 0,
      });
    }
    return results;
  }

  return {
    endpoint,
    pipeline,
    /** Run one statement and return its rows. */
    async query(sql, args = []) {
      const [result] = await pipeline([[sql, args]]);
      return result?.rows ?? [];
    },
    /** Run one statement, ignoring rows. */
    async execute(sql, args = []) {
      const [result] = await pipeline([[sql, args]]);
      return result?.rowsAffected ?? 0;
    },
    /**
     * Run many statements in chunks so a large seed does not exceed the
     * request size limit.
     */
    async batch(statements, chunkSize = 100) {
      let affected = 0;
      for (let i = 0; i < statements.length; i += chunkSize) {
        const results = await pipeline(statements.slice(i, i + chunkSize));
        affected += results.reduce((sum, r) => sum + r.rowsAffected, 0);
      }
      return affected;
    },
  };
}
