// Pull ETS's officially scored sample Issue essays out of the published
// practice-test response PDFs.
//
//   node scripts/extract-calibration.mjs
//
// These essays are the only ground truth available for the heuristic scorer.
// Without them the trait weights would be invented, so calibration treats them
// as a regression suite: the engine has to reproduce ETS's own scores.
//
// Output is gitignored and goes to the database, never to git.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { extractPdfPages } from './lib/pdf-text.mjs';

const SOURCES = [
  {
    name: 'GRE Practice Test 3',
    url: 'https://www.ets.org/pdfs/gre/gre-practice-test-3%20writing-responses-18-point.pdf',
  },
];

// The scored samples appear as an essay introduced by a header line, followed
// by the rater's commentary. We only want Issue essays; the Argument task was
// retired from the GRE in 2023 and its samples would poison calibration.
const ESSAY_HEADER = /The following sample issue response received a score of ([0-6])\s*:\s*/gi;
const COMMENTARY_HEADER = /Comments on sample essay receiving score of ([0-6])\s*:\s*/i;

// The last scored essay in the document has no following header, so its
// commentary would otherwise absorb the rest of the file: the Argument task
// samples, the scoring guides, everything. These are the structural markers
// that end a commentary block.
const COMMENTARY_BOUNDARIES = [
  /The following sample (issue|argument) response received a score of/i,
  /Sample (Issue|Argument) Topic\s*:/i,
  /GRE\s*®?\s*Scoring Guide\s*:/i,
  /NO TEST MATERIAL ON THIS PAGE/i,
  /End of The Graduate Record Examinations/i,
];

// Page furniture that survives extraction.
const FURNITURE = [
  /-\d{1,3}-/g,
  /GRE General \[This footer should NOT be printed[^\]]*\]/gi,
  /\d{1,2}\/\d{1,2}\/\d{4}\s*LT\d+-\w+[-\w]*/gi,
  /End of The Graduate Record Examinations[^.]*\./gi,
];

function scrub(text) {
  let cleaned = text;
  for (const pattern of FURNITURE) cleaned = cleaned.replace(pattern, ' ');
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Slice out every scored Issue essay and its rater commentary.
 *
 * Layout in the source is: header, essay body, commentary header, commentary,
 * then the next header. So each essay runs from its header to the commentary
 * header that follows it.
 */
export function parseScoredEssays(rawText) {
  const headers = [...rawText.matchAll(ESSAY_HEADER)];
  const samples = [];

  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    const score = Number.parseInt(header[1], 10);
    const sectionEnd = i + 1 < headers.length ? headers[i + 1].index : rawText.length;
    const section = rawText.slice(header.index + header[0].length, sectionEnd);

    const commentaryMatch = COMMENTARY_HEADER.exec(section);
    if (!commentaryMatch) continue;

    const body = scrub(section.slice(0, commentaryMatch.index));

    let commentaryRaw = section.slice(commentaryMatch.index + commentaryMatch[0].length);
    let commentaryEnd = commentaryRaw.length;
    for (const boundary of COMMENTARY_BOUNDARIES) {
      const hit = boundary.exec(commentaryRaw);
      if (hit && hit.index < commentaryEnd) commentaryEnd = hit.index;
    }
    const commentary = scrub(commentaryRaw.slice(0, commentaryEnd));

    // The commentary that follows an essay must be about that same score.
    if (Number.parseInt(commentaryMatch[1], 10) !== score) continue;
    if (body.split(/\s+/).length < 25) continue;

    samples.push({
      officialScore: score,
      body,
      raterCommentary: commentary,
      wordCount: body.split(/\s+/).length,
    });
  }

  // Keep the highest-quality sample per score level if a source repeats one.
  const bestByScore = new Map();
  for (const sample of samples) {
    const existing = bestByScore.get(sample.officialScore);
    if (!existing || sample.wordCount > existing.wordCount) bestByScore.set(sample.officialScore, sample);
  }
  return [...bestByScore.values()].sort((a, b) => a.officialScore - b.officialScore);
}

/**
 * Reassemble the document in reading order.
 *
 * The response PDFs store their pages out of order, which splits sample
 * headers across the join and makes them unmatchable. Every page prints its
 * number as "-N-" at the start of the extracted run, so sorting on that marker
 * restores reading order.
 */
function assembleInReadingOrder(buffer) {
  const numbered = [];
  for (const page of extractPdfPages(buffer)) {
    const match = /^-(\d{1,3})-/.exec(page);
    if (!match) continue;
    numbered.push({ page: Number.parseInt(match[1], 10), text: page });
  }
  if (numbered.length === 0) throw new Error('No page markers found; cannot establish reading order.');
  numbered.sort((a, b) => a.page - b.page);
  return numbered.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
}

async function fetchPdf(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const collected = [];

  for (const source of SOURCES) {
    process.stdout.write(`Fetching ${source.name}... `);
    let text;
    try {
      text = assembleInReadingOrder(await fetchPdf(source.url));
    } catch (error) {
      console.log(`skipped (${error.message})`);
      continue;
    }
    const samples = parseScoredEssays(text).map((s) => ({ ...s, source: source.name }));
    console.log(`${samples.length} scored Issue essays (levels ${samples.map((s) => s.officialScore).join(', ')})`);
    collected.push(...samples);
  }

  const byScore = new Map();
  for (const sample of collected) {
    const existing = byScore.get(sample.officialScore);
    if (!existing || sample.wordCount > existing.wordCount) byScore.set(sample.officialScore, sample);
  }
  const calibration = [...byScore.values()].sort((a, b) => a.officialScore - b.officialScore);

  const missing = [1, 2, 3, 4, 5, 6].filter((s) => !byScore.has(s));
  if (missing.length > 0) {
    throw new Error(`Missing scored samples for level(s) ${missing.join(', ')}. Calibration needs the full range.`);
  }

  const outDir = path.join(process.cwd(), 'seed-data');
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'calibration.json');
  await writeFile(outFile, JSON.stringify(calibration, null, 2), 'utf8');

  console.log(`\nCalibration set: ${calibration.length} essays`);
  for (const sample of calibration) {
    console.log(`  score ${sample.officialScore}: ${sample.wordCount} words, ${sample.raterCommentary.split(/\s+/).length} words of commentary`);
  }
  console.log(`Wrote ${outFile}`);
}

if (process.argv[1]?.endsWith('extract-calibration.mjs')) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
