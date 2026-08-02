// Write a complete worked response for each stance on each topic.
//
//   node scripts/author-model-essays.mjs [--concurrency 2] [--limit 40]
//
// The result page shows "Example 01 / Mostly Agree" broken into Introduction,
// Support 01, Support 02, Concession and rebuttal, and Conclusion. Those blocks
// used to contain instructions ("State the position outright and qualify
// it..."), which is not an example of anything.
//
// Each essay is built from the topic's own authored reasons and concession, so
// the worked response and the guidance beside it argue the same case instead of
// drifting apart.
//
// Acceptance is gated on our own scorer. An essay we hold up as a model that
// the app would grade a 4 is not a model. That also cross-checks the scorer:
// if nothing can pass, one of the two is wrong.
//
// Resumable and safe to re-run. Free-tier daily quota is per model and small,
// so a full run spreads over several days.

import { loadEnv, createClient } from './lib/turso.mjs';
import { scoreEssay } from '../lib/scoring/index.mjs';
import { detectConcessionMoves, detectStance } from '../lib/scoring/structure.mjs';

const MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-2.0-flash',
];
const exhausted = new Set();

const STANCE_WORDS = {
  support: { verb: 'largely agree', label: 'Mostly Agree' },
  oppose: { verb: 'largely disagree', label: 'Mostly Disagree' },
};

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildPrompt(topic, side, reasons, concession, examples) {
  const stance = STANCE_WORDS[side];
  const reasonText = reasons
    .map((r, i) => `  ${i + 1}. ${r.claim}\n     Why: ${r.mechanism}${r.example ? `\n     Example available: ${r.example.title}. ${r.example.summary}` : ''}`)
    .join('\n');

  return `Write a model GRE "Analyze an Issue" response that would earn a 6.

PROMPT:
${topic.statement}
${topic.task_instruction}

STANCE: ${stance.label}. The essay must ${stance.verb} with the prompt, qualified rather than absolute.

USE THESE REASONS, which have already been written for this topic. Develop the first two into full paragraphs:
${reasonText}

USE THIS CONCESSION AND REBUTTAL:
  Concede: ${concession.concession}
  Then: ${concession.rebuttal}

REQUIREMENTS:
- Five paragraphs: introduction, two support paragraphs, one concession-and-rebuttal paragraph, conclusion.
- 520 to 580 words in total. This is checked.
- The introduction must state the position in the first two sentences using a qualifier such as "largely", "mostly" or "for the most part", and signal the two reasons that follow.
- Each support paragraph develops one reason and grounds it in a concrete, named, factually accurate example. Do not invent statistics or events.
- The concession paragraph must concede genuinely and then take the ground back, using a clear pivot such as "However" or "Yet". Do not concede and leave it standing.
- The conclusion must restate the qualified position and say why the distinction matters. Do not merely repeat the introduction.
- Write as a strong test taker would under thirty minutes: clear, direct, varied sentence length. Not florid.
- No em dashes anywhere. No headings or labels inside the paragraphs.

Return ONLY JSON, no markdown fence:
{"intro":"...","support_1":"...","support_2":"...","concession":"...","conclusion":"..."}`;
}

async function callGemini(apiKey, prompt, model) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 16000, responseMimeType: 'application/json' },
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

async function draft(apiKey, prompt, attempts = 5) {
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

const PARTS = ['intro', 'support_1', 'support_2', 'concession', 'conclusion'];

/**
 * Accept only essays the app itself would grade well.
 *
 * The scorer was made trustworthy first precisely so this gate means something.
 */
function validate(essay, topic) {
  const problems = [];

  for (const part of PARTS) {
    if (typeof essay[part] !== 'string' || essay[part].trim().split(/\s+/).length < 25) {
      problems.push(`${part} missing or too short`);
    }
  }
  if (problems.length > 0) return { problems, text: '', score: null };

  const text = PARTS.map((part) => essay[part].trim()).join('\n\n');
  const words = text.split(/\s+/).length;

  if (text.includes('—')) problems.push('contains an em dash');
  if (words < 480 || words > 640) problems.push(`${words} words, outside the 480 to 640 range`);

  const stance = detectStance(text);
  if (!stance.inFirstParagraph) problems.push('no stance detected in the opening paragraph');

  const moves = detectConcessionMoves(text);
  if (moves.completeMoves.length === 0) problems.push('no completed concede-and-rebut move detected');

  const score = scoreEssay(text, {
    statement: topic.statement,
    taskInstruction: topic.task_instruction,
    taskType: topic.task_type,
  });
  if (score.tooShort) problems.push('scored as too short');
  else if (score.holistic < 5) problems.push(`our own scorer grades it ${score.holistic}, below 5.0`);

  return { problems, text, score: score.tooShort ? null : score.holistic };
}

async function pool(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const env = await loadEnv();
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

  const db = createClient(env);
  const concurrency = Number.parseInt(arg('concurrency', '2'), 10);
  const limit = Number.parseInt(arg('limit', '400'), 10);

  const topics = await db.query('SELECT id, statement, task_instruction, task_type FROM topics ORDER BY id');
  const reasons = await db.query('SELECT topic_id, side, ord, claim, mechanism, example_slug FROM topic_reasons ORDER BY topic_id, side, ord');
  const concessions = await db.query('SELECT topic_id, side, concession, rebuttal FROM topic_concessions');
  const examples = await db.query('SELECT slug, title, summary FROM examples');
  const done = new Set(
    (await db.query('SELECT topic_id, side FROM model_essays')).map((r) => `${r.topic_id}:${r.side}`)
  );

  const exampleBySlug = new Map(examples.map((e) => [e.slug, e]));
  const reasonsFor = (topicId, side) =>
    reasons
      .filter((r) => r.topic_id === topicId && r.side === side)
      .map((r) => ({ ...r, example: r.example_slug ? exampleBySlug.get(r.example_slug) : null }));
  const concessionFor = (topicId, side) =>
    concessions.find((c) => c.topic_id === topicId && c.side === side);

  const jobs = [];
  for (const topic of topics) {
    for (const side of ['support', 'oppose']) {
      if (done.has(`${topic.id}:${side}`)) continue;
      const topicReasons = reasonsFor(topic.id, side);
      const concession = concessionFor(topic.id, side);
      if (topicReasons.length < 2 || !concession) continue;
      jobs.push({ topic, side, reasons: topicReasons, concession });
    }
  }

  const selected = jobs.slice(0, limit);
  console.log(`${done.size} model essays already written. Attempting ${selected.length} of ${jobs.length} remaining.\n`);

  let written = 0;
  let rejected = 0;
  let stopped = false;

  await pool(selected, concurrency, async (job) => {
    if (stopped) return;

    let feedback = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let essay;
      try {
        const prompt = buildPrompt(job.topic, job.side, job.reasons, job.concession)
          + (feedback ? `\n\nA previous attempt was rejected for: ${feedback}. Fix it.` : '');
        essay = await draft(apiKey, prompt);
      } catch (error) {
        console.log(`\nStopped: ${error.message}. Re-run to continue.`);
        stopped = true;
        return;
      }

      const { problems, text, score } = validate(essay, job.topic);
      if (problems.length === 0) {
        await db.execute(
          `INSERT INTO model_essays (topic_id, side, intro, support_1, support_2, concession, conclusion, word_count, self_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (topic_id, side) DO UPDATE SET
             intro = excluded.intro, support_1 = excluded.support_1, support_2 = excluded.support_2,
             concession = excluded.concession, conclusion = excluded.conclusion,
             word_count = excluded.word_count, self_score = excluded.self_score`,
          [
            job.topic.id,
            job.side,
            essay.intro.trim(),
            essay.support_1.trim(),
            essay.support_2.trim(),
            essay.concession.trim(),
            essay.conclusion.trim(),
            text.split(/\s+/).length,
            score,
          ]
        );
        written += 1;
        process.stdout.write(`  ${written} written, ${rejected} rejected\r`);
        return;
      }

      feedback = problems.slice(0, 3).join('; ');
      if (attempt === 2) {
        rejected += 1;
        console.log(`\n  topic ${job.topic.id} ${job.side}: ${feedback}`);
      }
    }
  });

  const [{ n }] = await db.query('SELECT COUNT(*) AS n FROM model_essays');
  const [{ avg }] = await db.query('SELECT ROUND(AVG(self_score), 2) AS avg FROM model_essays');
  console.log(`\n\n${n} of 318 model essays written. Mean self-score ${avg}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
