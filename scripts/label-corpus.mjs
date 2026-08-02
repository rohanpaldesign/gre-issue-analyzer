// Relabel a sample of the training corpus on the ETS scale.
//
//   node scripts/label-corpus.mjs --validate      check the teacher first
//   node scripts/label-corpus.mjs [--target 500]  label the sample
//
// Why this exists. The scorer's weights are fitted on PERSUADE, which is grade
// 6 to 12 writing scored on its own rubric, and then mapped onto ETS's scale by
// an affine fit over eleven anchor essays. Eleven points cannot correct a
// whole-distribution shift, so a competent GRE-register essay reads as a
// top-decile PERSUADE essay and inherits a top-decile score. That is why a 382
// word response came out at 6.0.
//
// The fix is ETS-scale labels on the same text the model is fitted to. This
// script produces them by having Gemini score corpus essays against the
// verbatim ETS rubric.
//
// That is only legitimate if the teacher can actually reproduce ETS's own
// judgments, so --validate scores the eleven published essays first and
// reports the error. If it fails the gate, these labels must not be used.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, createClient } from './lib/turso.mjs';
import { ETS_RUBRIC, ETS_LENGTH_CONTEXT } from './lib/ets-rubric.mjs';

const SEED_DIR = path.join(process.cwd(), 'seed-data');
const MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-2.0-flash',
];
const exhausted = new Set();

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildPrompt(essays) {
  const items = essays
    .map((essay, index) => `--- ESSAY ${index + 1} ---\n${essay.text.slice(0, 9000)}`)
    .join('\n\n');

  return `You are an experienced ETS rater scoring responses to the GRE "Analyze an Issue" task.

OFFICIAL ETS SCORING GUIDE:
${ETS_RUBRIC}

${ETS_LENGTH_CONTEXT}

Score each essay below on the ETS 1 to 6 scale. Half points are allowed. Be strict: these are being used to calibrate an automated scorer, and a rater who drifts high produces a scorer that tells people they are ready when they are not.

${items}

Return ONLY JSON, one object per essay in order, no markdown fence:
[{"essay": 1, "holistic": 3.5, "position": 4, "development": 3, "organization": 4, "language": 3, "conventions": 4}]`;
}

async function callGemini(apiKey, prompt, model) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8000, responseMimeType: 'application/json' },
      }),
    }
  );

  if (response.status === 429 || response.status === 503) {
    const body = await response.text();
    const error = new Error(`rate limited (${response.status})`);
    if (/PerDay/i.test(body)) error.quotaExhausted = true;
    else error.retryable = true;
    throw error;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error('empty response');
  return JSON.parse(text.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim());
}

async function score(apiKey, essays, attempts = 5) {
  const prompt = buildPrompt(essays);
  let lastError;

  for (const model of MODELS) {
    if (exhausted.has(model)) continue;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return { model, rows: await callGemini(apiKey, prompt, model) };
      } catch (error) {
        lastError = error;
        if (error.quotaExhausted) {
          if (!exhausted.has(model)) {
            exhausted.add(model);
            console.log(`\n  daily quota exhausted for ${model}, moving on`);
          }
          break;
        }
        if (!error.retryable || attempt === attempts - 1) break;
        await sleep(Math.min(45000, 2500 * 2 ** attempt) + Math.floor(Math.random() * 1200));
      }
    }
  }
  throw lastError ?? new Error('every model exhausted');
}

function rankOf(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length);
  order.forEach((entry, rank) => {
    ranks[entry.index] = rank + 1;
  });
  return ranks;
}

function pearson(a, b) {
  const n = a.length;
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    num += (a[i] - meanA) * (b[i] - meanB);
    da += (a[i] - meanA) ** 2;
    db += (b[i] - meanB) ** 2;
  }
  return num / Math.sqrt(da * db);
}

/**
 * Check the teacher against ETS's own scored essays before trusting it.
 *
 * If Gemini cannot reproduce the judgments of the people who wrote the rubric,
 * its labels are not a standard to fit against, and this whole approach has to
 * be abandoned rather than quietly used.
 */
async function validate(apiKey) {
  const anchors = JSON.parse(await readFile(path.join(SEED_DIR, 'calibration.json'), 'utf8'));
  console.log(`Scoring ${anchors.length} official ETS essays through the labelling prompt...\n`);

  const predicted = [];
  for (let i = 0; i < anchors.length; i += 4) {
    const batch = anchors.slice(i, i + 4).map((a) => ({ text: a.body }));
    const { rows, model } = await score(apiKey, batch);
    rows.forEach((row, index) => {
      const anchor = anchors[i + index];
      if (!anchor) return;
      predicted.push({ official: anchor.officialScore, ai: Number(row.holistic), words: anchor.wordCount, model });
    });
  }

  console.log('  official   AI    error   words');
  let absTotal = 0;
  let signedTotal = 0;
  for (const row of predicted) {
    const error = row.ai - row.official;
    absTotal += Math.abs(error);
    signedTotal += error;
    console.log(
      `      ${row.official}     ${String(row.ai).padStart(4)}   ${(error >= 0 ? '+' : '') + error.toFixed(1)}    ${String(row.words).padStart(4)}`
    );
  }

  const mae = absTotal / predicted.length;
  const bias = signedTotal / predicted.length;
  const spearman = pearson(
    rankOf(predicted.map((r) => r.official)),
    rankOf(predicted.map((r) => r.ai))
  );

  console.log(`\n  MAE ${mae.toFixed(3)}   mean signed error ${bias >= 0 ? '+' : ''}${bias.toFixed(3)}   Spearman ${spearman.toFixed(3)}`);

  const failures = [];
  if (mae > 0.5) failures.push(`MAE ${mae.toFixed(2)} exceeds 0.50`);
  if (spearman < 0.9) failures.push(`Spearman ${spearman.toFixed(2)} is below 0.90`);
  if (Math.abs(bias) > 0.4) failures.push(`bias ${bias.toFixed(2)} exceeds 0.40, the teacher itself drifts`);

  if (failures.length > 0) {
    console.error('\nTEACHER REJECTED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('\nDo not fit on these labels. Fix the length curve and ceiling instead.');
    process.exit(1);
  }

  console.log('\nTeacher accepted. Its labels can be used for calibration.');
}

async function label(apiKey, env) {
  const db = createClient(env);
  const target = Number.parseInt(arg('target', '500'), 10);
  const train = JSON.parse(await readFile(path.join(SEED_DIR, 'corpus-train.json'), 'utf8'));

  // Stratified so every score level is represented, not just the crowded
  // middle. Deterministic order so a resumed run picks the same essays.
  const byScore = new Map();
  for (const essay of train) {
    if (!byScore.has(essay.score)) byScore.set(essay.score, []);
    byScore.get(essay.score).push(essay);
  }
  const perLevel = Math.ceil(target / byScore.size);
  const sample = [];
  for (const [, group] of [...byScore.entries()].sort((a, b) => a[0] - b[0])) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    sample.push(...group.slice(0, perLevel));
  }

  const done = new Set(
    (await db.query('SELECT essay_ref FROM corpus_labels')).map((row) => row.essay_ref)
  );
  const todo = sample.filter((essay) => !done.has(essay.id));

  console.log(`${done.size} already labelled. ${todo.length} to go (target ${sample.length}).`);

  let labelled = 0;
  for (let i = 0; i < todo.length; i += 5) {
    const batch = todo.slice(i, i + 5);
    let result;
    try {
      result = await score(apiKey, batch.map((essay) => ({ text: essay.text })));
    } catch (error) {
      console.log(`\nStopped: ${error.message}. Re-run tomorrow to continue.`);
      break;
    }

    const statements = [];
    result.rows.forEach((row, index) => {
      const essay = batch[index];
      if (!essay || !Number.isFinite(Number(row.holistic))) return;
      statements.push([
        `INSERT INTO corpus_labels (essay_ref, ai_holistic, ai_traits, model)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (essay_ref) DO UPDATE SET
           ai_holistic = excluded.ai_holistic, ai_traits = excluded.ai_traits, model = excluded.model`,
        [
          essay.id,
          Number(row.holistic),
          JSON.stringify({
            position: row.position,
            development: row.development,
            organization: row.organization,
            language: row.language,
            conventions: row.conventions,
          }),
          result.model,
        ],
      ]);
    });

    if (statements.length > 0) {
      await db.batch(statements);
      labelled += statements.length;
    }
    process.stdout.write(`  ${labelled} labelled this run\r`);
  }

  const [{ n }] = await db.query('SELECT COUNT(*) AS n FROM corpus_labels');
  console.log(`\n\n${n} corpus essays now carry ETS-scale labels.`);
}

async function main() {
  const env = await loadEnv();
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

  if (process.argv.includes('--validate')) await validate(apiKey);
  else await label(apiKey, env);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
