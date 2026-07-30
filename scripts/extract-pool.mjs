// Parse the official ETS "Analyze an Issue" topic pool PDF into structured
// topics and write them to seed-data/ for the Turso seeder.
//
//   node scripts/extract-pool.mjs <path-to-issue-pool.pdf>
//
// Nothing this script produces is committed. The output is gitignored and its
// only destination is the database.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { extractPdfTextFromFile } from './lib/pdf-text.mjs';

const EXPECTED_TOPIC_COUNT = 159;

// Every task instruction in the pool ends with one of these clauses. Splitting
// on them is what separates an instruction from the next topic's statement.
const INSTRUCTION_ENDINGS = [
  'shape your position',
  'challenge your position',
  'address both of the views presented',
  'which that claim is based',
  'which the claim is based',
];

const INSTRUCTION_PATTERN = new RegExp(
  `^(Write a response.*?(?:${INSTRUCTION_ENDINGS.join('|')})\\.)\\s*`,
  's'
);

// The six canonical task types. ETS ships one instruction with a typo
// ("the claim" where every sibling reads "that claim"); it normalises here.
const TASK_TYPES = [
  {
    id: 'claim-reason',
    test: (i) => /the claim and the reason on which th(at|e) claim is based/.test(i),
    label: 'Claim and reason',
    demand: 'Address both the claim and the reason it rests on. Agreeing with one but not the other is a legitimate and often strong position.',
  },
  {
    id: 'two-views',
    test: (i) => /which view more closely aligns/.test(i),
    label: 'Two competing views',
    demand: 'Both views must be addressed explicitly, not just the one you side with.',
  },
  {
    id: 'policy',
    test: (i) => /your views on the policy/.test(i),
    label: 'Policy',
    demand: 'Discuss the likely consequences of implementing the policy, not just whether it sounds appealing.',
  },
  {
    id: 'recommendation',
    test: (i) => /with the recommendation/.test(i),
    label: 'Recommendation',
    demand: 'Describe specific circumstances in which following the recommendation would and would not be advantageous.',
  },
  {
    id: 'claim',
    test: (i) => /with the claim/.test(i),
    label: 'Claim',
    demand: 'Address the most compelling reasons or examples that could be used to challenge your own position.',
  },
  {
    id: 'statement',
    test: (i) => /with the statement/.test(i),
    label: 'Statement',
    demand: 'Consider ways in which the statement might and might not hold true.',
  },
];

// Theme tagging drives topic filtering, coverage tracking, and which reusable
// examples get surfaced. Order matters: the first two matches win.
const THEME_KEYWORDS = {
  education: ['school', 'student', 'univers', 'college', 'educat', 'teach', 'learn', 'curricul', 'classroom', 'academic', 'study', 'grade'],
  government: ['government', 'nation', 'state', 'law', 'politic', 'public official', 'policy', 'citizen', 'democra', 'vote', 'tax', 'leader of'],
  technology: ['technolog', 'machine', 'computer', 'internet', 'digital', 'innovat', 'invent', 'automat', 'online', 'media'],
  science: ['scien', 'research', 'experiment', 'discover', 'knowledge', 'fact', 'evidence', 'medic', 'environment'],
  arts: ['art', 'artist', 'music', 'literat', 'creativ', 'imagin', 'aesthetic', 'culture', 'humanities'],
  leadership: ['leader', 'authority', 'power', 'command', 'influence', 'manage', 'govern'],
  business: ['business', 'econom', 'industr', 'corporat', 'company', 'profit', 'work', 'employ', 'career', 'consumer', 'market'],
  society: ['society', 'social', 'communit', 'people', 'individual', 'group', 'public', 'popul', 'famil'],
  ethics: ['moral', 'ethic', 'right', 'wrong', 'virtue', 'honest', 'justice', 'duty', 'benefit of others', 'altruis'],
  history: ['histor', 'past', 'tradition', 'ancient', 'civilizat', 'memory'],
};

function classifyTaskType(instruction) {
  const match = TASK_TYPES.find((type) => type.test(instruction));
  if (!match) throw new Error(`Unrecognised task instruction: ${instruction.slice(0, 120)}`);
  return match.id;
}

function classifyThemes(statement) {
  const haystack = statement.toLowerCase();
  const scored = Object.entries(THEME_KEYWORDS)
    .map(([theme, keywords]) => [theme, keywords.filter((k) => haystack.includes(k)).length])
    .filter(([, hits]) => hits > 0)
    .sort((a, b) => b[1] - a[1]);
  const themes = scored.slice(0, 2).map(([theme]) => theme);
  return themes.length > 0 ? themes : ['society'];
}

/** Split a claim-and-reason topic into its two labelled halves. */
function splitClaimReason(statement) {
  const match = /^Claim:\s*(.+?)\s*Reason:\s*(.+)$/s.exec(statement);
  if (!match) return null;
  return { claim: match[1].trim(), reason: match[2].trim() };
}

export function parsePool(rawText) {
  // Drop the ETS front matter and the trailing copyright block.
  const introEnd = rawText.indexOf('actual test.');
  if (introEnd === -1) throw new Error('Could not locate the end of the ETS front matter.');
  let body = rawText.slice(introEnd + 'actual test.'.length);

  const copyrightStart = body.indexOf('Copyright ©');
  if (copyrightStart !== -1) body = body.slice(0, copyrightStart);

  // Page numbers survive extraction as bare integers between topics.
  body = body.replace(/\s\d{1,3}\s/g, ' ').replace(/\s+/g, ' ').trim();

  const blocks = body.split(/(?=Write a response)/);
  const topics = [];
  let statement = blocks[0].trim();

  for (const block of blocks.slice(1)) {
    const match = INSTRUCTION_PATTERN.exec(block);
    if (!match) {
      throw new Error(`Could not find an instruction ending in block: ${block.slice(0, 160)}`);
    }
    const instruction = match[1].replace(/\s+/g, ' ').trim();
    topics.push({ statement: statement.replace(/\s+/g, ' ').trim(), instruction });
    statement = block.slice(match[0].length).trim();
  }

  return topics.map((topic, index) => {
    const taskType = classifyTaskType(topic.instruction);
    const parts = taskType === 'claim-reason' ? splitClaimReason(topic.statement) : null;
    return {
      id: index + 1,
      statement: topic.statement,
      taskInstruction: topic.instruction,
      taskType,
      claim: parts?.claim ?? null,
      reason: parts?.reason ?? null,
      themes: classifyThemes(topic.statement),
    };
  });
}

function assertClean(topics) {
  const problems = [];

  if (topics.length !== EXPECTED_TOPIC_COUNT) {
    problems.push(`Expected ${EXPECTED_TOPIC_COUNT} topics, parsed ${topics.length}.`);
  }

  for (const topic of topics) {
    const where = `topic ${topic.id}`;
    if (topic.statement.length < 40) problems.push(`${where}: statement suspiciously short.`);
    if (/https?:|ETS\b|GRE ®|Copyright/.test(topic.statement)) {
      problems.push(`${where}: document furniture leaked into the statement.`);
    }
    if (/Write a response/.test(topic.statement)) {
      problems.push(`${where}: task instruction leaked into the statement.`);
    }
    if (topic.taskType === 'claim-reason' && !topic.claim) {
      problems.push(`${where}: claim-and-reason topic did not split into claim and reason.`);
    }
  }

  const byType = topics.reduce((acc, t) => ({ ...acc, [t.taskType]: (acc[t.taskType] ?? 0) + 1 }), {});
  if (Object.keys(byType).length !== 6) {
    problems.push(`Expected 6 task types, found ${Object.keys(byType).length}: ${Object.keys(byType).join(', ')}`);
  }

  if (problems.length > 0) {
    throw new Error(`Pool extraction failed its checks:\n  - ${problems.join('\n  - ')}`);
  }

  return byType;
}

async function main() {
  const source = process.argv[2] ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'Downloads', 'issue-pool.pdf');
  const outDir = path.join(process.cwd(), 'seed-data');
  const outFile = path.join(outDir, 'topics.json');

  const text = await extractPdfTextFromFile(source);
  const topics = parsePool(text);
  const byType = assertClean(topics);

  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, JSON.stringify(topics, null, 2), 'utf8');

  console.log(`Parsed ${topics.length} topics from ${source}`);
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(15)} ${count}`);
  }
  const themeCounts = {};
  for (const topic of topics) for (const theme of topic.themes) themeCounts[theme] = (themeCounts[theme] ?? 0) + 1;
  console.log('themes:', Object.entries(themeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}=${c}`).join(' '));
  console.log(`Wrote ${outFile}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('extract-pool.mjs')) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
