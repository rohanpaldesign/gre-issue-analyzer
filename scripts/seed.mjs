// Push content from seed-data/ into Turso. Idempotent: every write is an
// upsert keyed on a natural key, so this is safe to re-run as authored content
// lands in batches.
//
//   npm run db:seed

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient, loadEnv } from './lib/turso.mjs';

const SEED_DIR = path.join(process.cwd(), 'seed-data');

async function readOptionalJson(name) {
  try {
    return JSON.parse(await readFile(path.join(SEED_DIR, name), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Merge every guidance shard into one list.
 *
 * Authoring runs as several parallel processes over different id ranges, each
 * checkpointing to its own file, so the seeder collects whatever shards exist
 * and deduplicates by topic. That also makes a partial run seedable: whatever
 * finished can go to the database while the rest is still being written.
 */
async function readGuidanceShards() {
  const { readdir } = await import('node:fs/promises');
  let files;
  try {
    files = await readdir(SEED_DIR);
  } catch {
    return null;
  }

  const shards = files.filter((f) => /^guidance(-[\d-]+)?\.json$/.test(f)).sort();
  if (shards.length === 0) return null;

  const byTopic = new Map();
  for (const shard of shards) {
    const entries = (await readOptionalJson(shard)) ?? [];
    for (const entry of entries) byTopic.set(entry.topicId, entry);
  }
  return [...byTopic.values()].sort((a, b) => a.topicId - b.topicId);
}

async function seedTopics(db, topics) {
  const statements = topics.map((topic) => [
    `INSERT INTO topics (id, statement, task_instruction, task_type, claim, reason, themes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       statement = excluded.statement,
       task_instruction = excluded.task_instruction,
       task_type = excluded.task_type,
       claim = excluded.claim,
       reason = excluded.reason,
       themes = excluded.themes`,
    [
      topic.id,
      topic.statement,
      topic.taskInstruction,
      topic.taskType,
      topic.claim,
      topic.reason,
      JSON.stringify(topic.themes ?? []),
    ],
  ]);
  await db.batch(statements);
  return topics.length;
}

async function seedCalibration(db, essays) {
  const statements = essays.map((essay) => [
    `INSERT INTO calibration_essays (source, official_score, body, rater_commentary, word_count)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (source, official_score) DO UPDATE SET
       body = excluded.body,
       rater_commentary = excluded.rater_commentary,
       word_count = excluded.word_count`,
    [
      essay.source ?? 'ETS',
      essay.officialScore,
      essay.body,
      essay.raterCommentary ?? '',
      essay.wordCount ?? essay.body.split(/\s+/).length,
    ],
  ]);
  await db.batch(statements);
  return essays.length;
}

async function seedExamples(db, examples) {
  const statements = examples.map((example) => [
    `INSERT INTO examples (slug, title, domain, summary, key_facts, moves)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (slug) DO UPDATE SET
       title = excluded.title,
       domain = excluded.domain,
       summary = excluded.summary,
       key_facts = excluded.key_facts,
       moves = excluded.moves`,
    [
      example.slug,
      example.title,
      example.domain,
      example.summary,
      JSON.stringify(example.keyFacts ?? []),
      JSON.stringify(example.moves ?? []),
    ],
  ]);
  await db.batch(statements);
  return examples.length;
}

async function seedGuidance(db, guidance) {
  const statements = [];
  let reasons = 0;
  let concessions = 0;
  let links = 0;

  for (const entry of guidance) {
    for (const side of ['support', 'oppose']) {
      (entry[side] ?? []).forEach((reason, index) => {
        reasons += 1;
        statements.push([
          `INSERT INTO topic_reasons (topic_id, side, ord, claim, mechanism, example_slug)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (topic_id, side, ord) DO UPDATE SET
             claim = excluded.claim,
             mechanism = excluded.mechanism,
             example_slug = excluded.example_slug`,
          [entry.topicId, side, index, reason.claim, reason.mechanism, reason.exampleSlug ?? null],
        ]);
      });

      const concession = entry.concessions?.[side];
      if (concession) {
        concessions += 1;
        statements.push([
          `INSERT INTO topic_concessions (topic_id, side, concession, rebuttal)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (topic_id, side) DO UPDATE SET
             concession = excluded.concession,
             rebuttal = excluded.rebuttal`,
          [entry.topicId, side, concession.concession, concession.rebuttal],
        ]);
      }
    }

    // Which reusable examples this topic actually uses, derived from the
    // reasons rather than authored separately. This is what powers "here are
    // the examples worth preparing for this prompt".
    const usedExamples = new Map();
    for (const side of ['support', 'oppose']) {
      for (const reason of entry[side] ?? []) {
        if (!reason.exampleSlug) continue;
        if (!usedExamples.has(reason.exampleSlug)) {
          usedExamples.set(reason.exampleSlug, `${side === 'support' ? 'Supports' : 'Opposes'}: ${reason.claim}`);
        }
      }
    }
    for (const [slug, relevance] of usedExamples) {
      links += 1;
      statements.push([
        `INSERT INTO topic_examples (topic_id, example_slug, relevance)
         VALUES (?, ?, ?)
         ON CONFLICT (topic_id, example_slug) DO UPDATE SET relevance = excluded.relevance`,
        [entry.topicId, slug, relevance],
      ]);
    }
  }

  await db.batch(statements);
  return { reasons, concessions, links };
}

async function main() {
  const env = await loadEnv();
  const db = createClient(env);

  const topics = await readOptionalJson('topics.json');
  const calibration = await readOptionalJson('calibration.json');
  const examples = await readOptionalJson('examples.json');
  const guidance = await readGuidanceShards();

  if (!topics) throw new Error('seed-data/topics.json is missing. Run `npm run extract:pool` first.');

  console.log(`topics:      ${await seedTopics(db, topics)}`);
  if (calibration) console.log(`calibration: ${await seedCalibration(db, calibration)}`);
  // Examples must land before guidance, which references them by slug.
  if (examples) console.log(`examples:    ${await seedExamples(db, examples)}`);
  if (guidance) {
    const counts = await seedGuidance(db, guidance);
    console.log(`guidance:    ${counts.reasons} reasons, ${counts.concessions} concessions, ${counts.links} example links`);
  }

  const [{ topics: t }] = await db.query('SELECT COUNT(*) AS topics FROM topics');
  const [{ n: r }] = await db.query('SELECT COUNT(*) AS n FROM topic_reasons');
  console.log(`\nIn database: ${t} topics, ${r} reasons.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
