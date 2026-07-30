// Reduce the PERSUADE 2.0 corpus to the subset that is useful for calibrating
// a GRE Issue scorer, and attach the human discourse annotations.
//
//   node scripts/prepare-corpus.mjs <path-to-persuade.csv>
//
// Why this corpus: it is 15,000+ argumentative essays scored 1 to 6 by humans,
// with spans annotated as Position, Claim, Evidence, Counterclaim, Rebuttal and
// Concluding Statement. Those annotations map onto the essay structure this app
// teaches, so they double as ground truth for the structure detectors.
//
// Why only part of it: the "Text dependent" half asks students to write from a
// provided source text, which is not what the GRE Issue task is. Only the
// "Independent" half is prompt-only and therefore analogous.
//
// Licence: PERSUADE 2.0 is CC BY-NC-SA 4.0 (Crossley et al., 2024). The data
// stays out of git and out of any commercial use.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const WANTED_TASK = 'Independent';

/** Streaming CSV row parser that tolerates quoted newlines and doubled quotes. */
async function* parseCsvRows(filePath) {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  let field = '';
  let row = [];
  let inQuotes = false;
  let pendingQuote = false;

  for await (const chunk of stream) {
    for (const char of chunk) {
      if (pendingQuote) {
        pendingQuote = false;
        if (char === '"') {
          field += '"';
          continue;
        }
        inQuotes = false;
      }

      if (inQuotes) {
        if (char === '"') pendingQuote = true;
        else field += char;
        continue;
      }

      if (char === '"') inQuotes = true;
      else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field);
        field = '';
        if (row.length > 1 || row[0] !== '') yield row;
        row = [];
      } else if (char !== '\r') {
        field += char;
      }
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    yield row;
  }
}

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error('Usage: node scripts/prepare-corpus.mjs <path-to-persuade.csv>');

  const essays = new Map();
  let header = null;
  let rowCount = 0;

  for await (const row of parseCsvRows(source)) {
    if (!header) {
      header = row;
      continue;
    }
    rowCount += 1;
    const record = Object.fromEntries(header.map((name, i) => [name, row[i] ?? '']));
    if (record.task !== WANTED_TASK) continue;

    const id = record.essay_id;
    if (!essays.has(id)) {
      const score = Number.parseFloat(record.holistic_essay_score);
      if (!Number.isFinite(score)) continue;
      essays.set(id, {
        id,
        score,
        text: record.full_text,
        prompt: record.prompt_name,
        grade: record.grade ? Number.parseInt(record.grade, 10) : null,
        discourse: [],
      });
    }

    const type = record.discourse_type;
    if (type && type !== 'Unannotated') {
      essays.get(id).discourse.push({
        type,
        start: Number.parseInt(record.discourse_start, 10),
        end: Number.parseInt(record.discourse_end, 10),
        effectiveness: record.discourse_effectiveness || null,
      });
    }

    if (rowCount % 200000 === 0) process.stdout.write(`  ...${rowCount} rows\r`);
  }

  const all = [...essays.values()];
  for (const essay of all) essay.discourse.sort((a, b) => a.start - b.start);

  // Hold out a stratified test split so fitted weights can be checked against
  // essays they were never tuned on. Deterministic: every 5th essay per score.
  const byScore = new Map();
  for (const essay of all) {
    if (!byScore.has(essay.score)) byScore.set(essay.score, []);
    byScore.get(essay.score).push(essay);
  }
  const train = [];
  const test = [];
  for (const [, group] of [...byScore.entries()].sort((a, b) => a[0] - b[0])) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    group.forEach((essay, index) => (index % 5 === 4 ? test : train).push(essay));
  }

  const outDir = path.join(process.cwd(), 'seed-data');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'corpus-train.json'), JSON.stringify(train), 'utf8');
  await writeFile(path.join(outDir, 'corpus-test.json'), JSON.stringify(test), 'utf8');

  const distribution = [...byScore.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([score, group]) => `${score}:${group.length}`)
    .join('  ');

  const annotations = {};
  for (const essay of all) {
    for (const span of essay.discourse) annotations[span.type] = (annotations[span.type] ?? 0) + 1;
  }

  console.log(`\nRead ${rowCount} rows.`);
  console.log(`${WANTED_TASK} essays: ${all.length}  (train ${train.length}, held-out test ${test.length})`);
  console.log(`Score distribution: ${distribution}`);
  console.log('Discourse spans:', Object.entries(annotations).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
