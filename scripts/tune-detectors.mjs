// Measure the structure detectors against human annotation.
//
//   node scripts/tune-detectors.mjs
//
// PERSUADE marks Counterclaim, Rebuttal and Position spans by hand. That makes
// them ground truth for the detectors behind the GregMat structure panel, which
// has to be right: conceding and then shutting the concession down is a
// required move, not a stylistic nicety, so a detector that misses two thirds
// of them would tell writers they had skipped a paragraph they actually wrote.
//
// Reports precision, recall and F1 at essay level, plus span-level localisation
// (did we fire in the right place, not merely somewhere in the essay).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { detectConcessionMoves, detectStance } from '../lib/scoring/structure.mjs';

const SEED_DIR = path.join(process.cwd(), 'seed-data');

function prf(tp, fp, fn) {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function report(label, stats) {
  const { precision, recall, f1 } = prf(stats.tp, stats.fp, stats.fn);
  console.log(
    `  ${label.padEnd(24)} P ${(precision * 100).toFixed(1).padStart(5)}%  ` +
    `R ${(recall * 100).toFixed(1).padStart(5)}%  F1 ${(f1 * 100).toFixed(1).padStart(5)}%  ` +
    `base ${((100 * (stats.tp + stats.fn)) / stats.total).toFixed(1)}%`
  );
  return f1;
}

async function main() {
  const essays = JSON.parse(await readFile(path.join(SEED_DIR, 'corpus-test.json'), 'utf8'));

  const concession = { tp: 0, fp: 0, fn: 0, total: 0 };
  const fullMove = { tp: 0, fp: 0, fn: 0, total: 0 };
  const stance = { tp: 0, fp: 0, fn: 0, total: 0 };
  let localisedHits = 0;
  let localisedTotal = 0;

  for (const essay of essays) {
    const types = new Set(essay.discourse.map((span) => span.type));
    const humanCounterclaim = types.has('Counterclaim');
    const humanRebuttal = types.has('Rebuttal');
    const humanPosition = types.has('Position');

    const moves = detectConcessionMoves(essay.text);
    const firedConcession = moves.concessions.length > 0;
    const firedFullMove = moves.completeMoves.length > 0;

    concession.total += 1;
    if (humanCounterclaim && firedConcession) concession.tp += 1;
    else if (!humanCounterclaim && firedConcession) concession.fp += 1;
    else if (humanCounterclaim && !firedConcession) concession.fn += 1;

    const humanCompleteMove = humanCounterclaim && humanRebuttal;
    fullMove.total += 1;
    if (humanCompleteMove && firedFullMove) fullMove.tp += 1;
    else if (!humanCompleteMove && firedFullMove) fullMove.fp += 1;
    else if (humanCompleteMove && !firedFullMove) fullMove.fn += 1;

    const stanceHit = detectStance(essay.text).strength > 0;
    stance.total += 1;
    if (humanPosition && stanceHit) stance.tp += 1;
    else if (!humanPosition && stanceHit) stance.fp += 1;
    else if (humanPosition && !stanceHit) stance.fn += 1;

    if (humanCounterclaim && firedConcession) {
      const humanSpans = essay.discourse.filter((s) => s.type === 'Counterclaim');
      localisedTotal += 1;
      const overlaps = moves.concessions.some((move) =>
        humanSpans.some((span) => move.index < span.end + 40 && move.index + move.length > span.start - 160)
      );
      if (overlaps) localisedHits += 1;
    }
  }

  console.log(`Evaluated ${essays.length} held-out essays.\n`);
  console.log('--- Detector accuracy vs human annotation ---');
  report('concession present', concession);
  report('concede + shut down', fullMove);
  report('position stated', stance);
  console.log(
    `\n  concessions landing on the human span: ${((100 * localisedHits) / Math.max(1, localisedTotal)).toFixed(1)}%`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
