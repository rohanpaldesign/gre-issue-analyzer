// Author per-topic reasoning for the whole pool, in parallel.
//
//   node scripts/author-guidance.mjs [--concurrency 6] [--batch 3] [--only 1-40]
//
// For each of the 159 topics this produces three supporting reasons, three
// opposing reasons, and the strongest concession with its rebuttal for each
// side, every reason naming a causal mechanism and attaching a concrete
// example drawn from the reusable bank in seed-data/examples.json.
//
// Drafting runs through Gemini on the free tier. That is a deliberate choice:
// hand-writing 159 topics by 8 items is roughly 1,300 pieces of reasoning, and
// the value here is in the standard being enforced rather than in the typing.
// Every draft is therefore validated before it is accepted, and anything that
// fails is retried with the failure fed back. The checks are in validate()
// below and they are strict about the one thing that matters: a reason has to
// engage THIS statement, not fit any prompt equally well.
//
// Output is gitignored and goes to Turso via scripts/seed.mjs.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, createClient } from './lib/turso.mjs';

const SEED_DIR = path.join(process.cwd(), 'seed-data');
// Free-tier daily quota is per model and much smaller than the headline
// figure: gemini-3.6-flash allows 20 requests per day, not 1500. The script
// therefore rotates through models, retiring each one as it is exhausted, so a
// single day's quota on any one model does not stall the whole run.
const MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.6-flash',
  'gemini-2.0-flash',
];
const exhausted = new Set();
const ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'that', 'this', 'these', 'those', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'will', 'would', 'should', 'can',
  'could', 'may', 'might', 'must', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'as',
  'from', 'it', 'its', 'they', 'them', 'their', 'we', 'our', 'you', 'your', 'not', 'no',
  'so', 'such', 'there', 'what', 'which', 'who', 'when', 'where', 'how', 'all', 'any',
  'more', 'most', 'other', 'some', 'only', 'own', 'same', 'very', 'than', 'then', 'people',
  'often', 'always', 'never', 'because', 'about', 'into', 'through', 'also', 'many', 'much',
]);

const stem = (word) => word.slice(0, 5);

function contentWords(text) {
  return new Set(
    (text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP_WORDS.has(w))
  );
}

const parseArg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};

function buildPrompt(topics, examples, feedback) {
  const bank = examples
    .map((e) => `  ${e.slug}: ${e.title}. ${e.summary} Supports: ${e.moves.join('; ')}`)
    .join('\n');

  const items = topics
    .map((t) => {
      const parts = [`TOPIC ${t.id} (task type: ${t.taskType})`, `Statement: ${t.statement}`];
      if (t.claim) parts.push(`Claim: ${t.claim}`, `Reason given: ${t.reason}`);
      return parts.join('\n');
    })
    .join('\n\n');

  return `You are preparing study material for the GRE "Analyze an Issue" task.

For each topic below, produce:
  - three reasons SUPPORTING the statement
  - three reasons OPPOSING it
  - for each side, the single strongest concession an opponent would make, and how to shut it down

RULES, all of which are checked automatically:

1. Every reason must engage THIS statement specifically. A reason that would fit
   any prompt equally well is worthless and will be rejected. Name the actual
   subject matter of the statement.
2. "claim" states the reason in one sentence.
3. "mechanism" explains WHY it holds: the causal chain, not a restatement. It
   must be a different sentence doing different work, and at least 15 words.
4. "exampleSlug" must be one of the bank slugs below, chosen because it actually
   illustrates that reason. Use null only if nothing in the bank fits.
5. Concessions must be the strongest version of the other side, not a strawman.
   The rebuttal must not simply repeat your original position; it must explain
   why the concession does not overturn it.
6. No em dashes anywhere. Plain prose. British or American spelling both fine.
${feedback ? `\n7. A previous attempt was rejected for: ${feedback}. Fix this.\n` : ''}
REUSABLE EXAMPLE BANK (use these slugs):
${bank}

TOPICS:
${items}

Return ONLY valid JSON, an array with one object per topic, no markdown fence:
[{"topicId":1,
  "support":[{"claim":"...","mechanism":"...","exampleSlug":"..."}],
  "oppose":[{"claim":"...","mechanism":"...","exampleSlug":"..."}],
  "concessions":{"support":{"concession":"...","rebuttal":"..."},
                 "oppose":{"concession":"...","rebuttal":"..."}}}]`;
}

/**
 * Reject drafts that do not meet the standard.
 *
 * The topic-overlap check is the important one. It is what stops the model
 * returning fluent generic reasoning that would fit any prompt, which is the
 * failure mode this whole pipeline exists to prevent.
 */
function validate(entry, topic, exampleSlugs) {
  const problems = [];
  const topicWords = contentWords(`${topic.statement} ${topic.claim ?? ''} ${topic.reason ?? ''}`);

  for (const side of ['support', 'oppose']) {
    const reasons = entry[side];
    if (!Array.isArray(reasons) || reasons.length < 3) {
      problems.push(`${side} needs three reasons, got ${reasons?.length ?? 0}`);
      continue;
    }

    reasons.forEach((reason, i) => {
      const where = `${side}[${i}]`;
      if (!reason.claim || reason.claim.split(/\s+/).length < 6) problems.push(`${where} claim too short`);
      if (!reason.mechanism || reason.mechanism.split(/\s+/).length < 15) {
        problems.push(`${where} mechanism too short, it must explain why`);
      }
      if (reason.claim && reason.mechanism && reason.claim.trim() === reason.mechanism.trim()) {
        problems.push(`${where} mechanism merely repeats the claim`);
      }
      if (reason.exampleSlug && !exampleSlugs.has(reason.exampleSlug)) {
        problems.push(`${where} unknown example slug "${reason.exampleSlug}"`);
      }
      // Topic specificity: the reason has to share real subject matter with the
      // statement it is supposed to be about.
      // Compared on a five character prefix so "teach" matches "teaching" and
      // "praise" matches "praising". Exact token matching rejected perfectly
      // good reasons purely for inflection.
      const reasonStems = new Set([...contentWords(`${reason.claim ?? ''} ${reason.mechanism ?? ''}`)].map(stem));
      let shared = 0;
      for (const word of topicWords) if (reasonStems.has(stem(word))) shared += 1;

      // Abstract prompts ("If a goal is worthy, then any means taken to attain
      // it are justifiable") have generic vocabulary, so a strong reason often
      // shares no words with them while being entirely specific. A reason
      // anchored to a named example from the bank is not filler, so that
      // satisfies the check on its own.
      if (shared === 0 && !reason.exampleSlug) {
        problems.push(`${where} is generic: it neither engages the statement nor cites a concrete example`);
      }
    });

    const concession = entry.concessions?.[side];
    if (!concession?.concession || !concession?.rebuttal) {
      problems.push(`${side} concession or rebuttal missing`);
    } else if (concession.rebuttal.split(/\s+/).length < 12) {
      problems.push(`${side} rebuttal too short to shut anything down`);
    }
  }

  if (JSON.stringify(entry).includes('—')) problems.push('contains an em dash');

  return problems;
}

async function callGemini(apiKey, prompt, model) {
  const response = await fetch(ENDPOINT(model), {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 32000, responseMimeType: 'application/json' },
    }),
  });

  if (response.status === 429 || response.status === 503) {
    const body = await response.text();
    const error = new Error(`rate limited (${response.status})`);
    // A per-day quota will not clear within this run, so retire the model
    // rather than backing off against it repeatedly.
    if (/PerDay/i.test(body)) error.quotaExhausted = true;
    else error.retryable = true;
    throw error;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text) throw new Error('empty response');

  const cleaned = text.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();
  return JSON.parse(cleaned);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call the API, retrying rate limits with exponential backoff.
 *
 * Rate-limit retries are counted separately from validation retries. Sharing
 * one budget meant a few 429s consumed every attempt and the batch was
 * abandoned as "exhausted retries" without the content ever being judged.
 */
async function callWithBackoff(apiKey, prompt, attempts = 6) {
  let lastError;

  for (const model of MODELS) {
    if (exhausted.has(model)) continue;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await callGemini(apiKey, prompt, model);
      } catch (error) {
        lastError = error;
        if (error.quotaExhausted) {
          if (!exhausted.has(model)) {
            exhausted.add(model);
            console.log(`
  daily quota exhausted for ${model}, moving on`);
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

async function authorBatch(apiKey, topics, examples, exampleSlugs) {
  let feedback = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const drafts = await callWithBackoff(apiKey, buildPrompt(topics, examples, feedback));
      const byId = new Map(drafts.map((d) => [d.topicId, d]));

      const accepted = [];
      const rejected = [];
      for (const topic of topics) {
        const draft = byId.get(topic.id);
        if (!draft) {
          rejected.push(`topic ${topic.id} missing from response`);
          continue;
        }
        const problems = validate(draft, topic, exampleSlugs);
        if (problems.length === 0) accepted.push({ ...draft, topicId: topic.id });
        else rejected.push(`topic ${topic.id}: ${problems.slice(0, 3).join('; ')}`);
      }

      if (rejected.length === 0) return { accepted, failed: [] };

      feedback = rejected.slice(0, 4).join(' | ');
      if (attempt === 2) return { accepted, failed: rejected };
    } catch (error) {
      if (attempt === 2) {
        return { accepted: [], failed: [`${topics.map((t) => t.id).join(',')}: ${error.message}`] };
      }
      await sleep(2000 * (attempt + 1));
    }
  }
  return { accepted: [], failed: [`${topics.map((t) => t.id).join(',')}: exhausted attempts`] };
}

/** Run tasks with a bounded number in flight. */
async function pool(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const env = await loadEnv();
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set. Run `vercel env pull .env.local`.');

  const topics = JSON.parse(await readFile(path.join(SEED_DIR, 'topics.json'), 'utf8'));
  const examples = JSON.parse(await readFile(path.join(SEED_DIR, 'examples.json'), 'utf8'));
  const exampleSlugs = new Set(examples.map((e) => e.slug));

  const concurrency = Number.parseInt(parseArg('concurrency', '6'), 10);
  const batchSize = Number.parseInt(parseArg('batch', '3'), 10);
  const only = parseArg('only', null);

  let selected = topics;
  if (only) {
    const [from, to] = only.split('-').map(Number);
    selected = topics.filter((t) => t.id >= from && t.id <= (to ?? from));
  }

  // Resume from the database, not from local files.
  //
  // Local shards proved unreliable as the source of truth: parallel shells
  // writing overlapping id ranges clobbered each other's checkpoints, and a
  // run that had already been seeded then looked unstarted. The database is
  // where this content lives, so it is what "already authored" means.
  const outFile = path.join(SEED_DIR, `guidance${only ? `-${only}` : ''}.json`);
  const done = new Set();
  try {
    const db = createClient(env);
    const rows = await db.query('SELECT DISTINCT topic_id FROM topic_reasons');
    for (const row of rows) done.add(row.topic_id);
    console.log(`${done.size} topics already authored in the database.`);
  } catch (error) {
    console.log(`Could not read the database (${error.message}); falling back to local shards.`);
    const { readdir } = await import('node:fs/promises');
    for (const file of (await readdir(SEED_DIR)).filter((f) => /^guidance.*\.json$/.test(f))) {
      for (const entry of JSON.parse(await readFile(path.join(SEED_DIR, file), 'utf8'))) done.add(entry.topicId);
    }
  }
  const existing = [];
  const todo = selected.filter((t) => !done.has(t.id));

  const batches = [];
  for (let i = 0; i < todo.length; i += batchSize) batches.push(todo.slice(i, i + batchSize));

  console.log(
    `Authoring ${todo.length} topics (${done.size} already done) in ${batches.length} batches, ${concurrency} at a time.`
  );

  const authored = [...existing];
  const failures = [];
  let completed = 0;

  await pool(batches, concurrency, async (batch) => {
    const { accepted, failed } = await authorBatch(apiKey, batch, examples, exampleSlugs);
    authored.push(...accepted);
    failures.push(...failed);
    completed += 1;
    process.stdout.write(
      `  ${completed}/${batches.length} batches, ${authored.length} topics authored, ${failures.length} failures\r`
    );
    // Checkpoint as we go so a crash or a quota wall never loses work.
    await mkdir(SEED_DIR, { recursive: true });
    await writeFile(outFile, JSON.stringify(authored.sort((a, b) => a.topicId - b.topicId), null, 2), 'utf8');
  });

  console.log(`\n\nAuthored ${authored.length} of ${selected.length} topics.`);
  if (failures.length > 0) {
    console.log(`${failures.length} batch failures:`);
    for (const failure of failures.slice(0, 12)) console.log(`  - ${failure}`);
  }
  console.log(`Wrote ${outFile}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
