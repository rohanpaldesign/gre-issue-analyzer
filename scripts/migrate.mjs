// Apply scripts/schema.sql to Turso. Safe to re-run.
//
//   npm run db:migrate

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, loadEnv } from './lib/turso.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Split on semicolons that terminate a statement, ignoring those in strings. */
function splitStatements(sql) {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  const env = await loadEnv();
  const db = createClient(env);

  const sql = await readFile(path.join(here, 'schema.sql'), 'utf8');
  const statements = splitStatements(sql);

  // SQLite has no ALTER TABLE ADD COLUMN IF NOT EXISTS, so a second run trips
  // over columns that already exist. Those run individually and their duplicate
  // errors are swallowed; every other failure still surfaces.
  const additive = statements.filter((s) => /^ALTER TABLE/i.test(s));
  const core = statements.filter((s) => !/^ALTER TABLE/i.test(s));

  await db.batch(core.map((s) => [s, []]), 25);

  let added = 0;
  for (const statement of additive) {
    try {
      await db.execute(statement);
      added += 1;
    } catch (error) {
      if (!/duplicate column name/i.test(error.message)) throw error;
    }
  }

  console.log(`Applied ${core.length} schema statements, ${added} new column(s).`);

  const tables = await db.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  console.log('Tables:', tables.map((t) => t.name).join(', '));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
