// Fit the holistic blend and check it honestly.
//
//   npm run calibrate
//
// Two data sources, doing two different jobs:
//
//   PERSUADE 2.0 (7,868 human-scored argumentative essays) fits the blend
//   weights. It has the sample size to do that, and its discourse annotations
//   let us verify the structure detectors against human judgment.
//
//   ETS's own scored samples anchor the result onto ETS's scale. PERSUADE is
//   grade 6-12 writing on a different rubric, so its 1-6 is not ETS's 1-6.
//   Fitting on PERSUADE alone would produce confident, wrongly-scaled numbers.
//
// The script refuses to write weights that fail the held-out checks.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractFeatures } from '../lib/scoring/features.mjs';
import { scoreTraits, TRAIT_KEYS } from '../lib/scoring/traits.mjs';
import { buildVector, standardise, VECTOR_KEYS, EXPECTED_SIGNS } from '../lib/scoring/vector.mjs';

const SEED_DIR = path.join(process.cwd(), 'seed-data');
const RIDGE_LAMBDA = 1e-3;

async function loadJson(name) {
  return JSON.parse(await readFile(path.join(SEED_DIR, name), 'utf8'));
}

/** Solve (X'X + lambda I) w = X'y by Gaussian elimination with partial pivoting. */
function ridgeFit(rows, targets, lambda = RIDGE_LAMBDA) {
  const featureCount = rows[0].length;
  const normal = Array.from({ length: featureCount }, () => new Float64Array(featureCount + 1));

  for (let i = 0; i < featureCount; i += 1) {
    for (let j = 0; j < featureCount; j += 1) {
      let sum = 0;
      for (let r = 0; r < rows.length; r += 1) sum += rows[r][i] * rows[r][j];
      normal[i][j] = sum + (i === j ? lambda * rows.length : 0);
    }
    let sum = 0;
    for (let r = 0; r < rows.length; r += 1) sum += rows[r][i] * targets[r];
    normal[i][featureCount] = sum;
  }

  for (let col = 0; col < featureCount; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < featureCount; r += 1) {
      if (Math.abs(normal[r][col]) > Math.abs(normal[pivot][col])) pivot = r;
    }
    [normal[col], normal[pivot]] = [normal[pivot], normal[col]];

    const divisor = normal[col][col];
    if (Math.abs(divisor) < 1e-12) continue;
    for (let c = col; c <= featureCount; c += 1) normal[col][c] /= divisor;

    for (let r = 0; r < featureCount; r += 1) {
      if (r === col) continue;
      const factor = normal[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= featureCount; c += 1) normal[r][c] -= factor * normal[col][c];
    }
  }

  return Array.from({ length: featureCount }, (_, i) => normal[i][featureCount]);
}

/** Quadratic weighted kappa, the standard agreement metric for essay scoring. */
function quadraticWeightedKappa(actual, predicted, min = 1, max = 6) {
  const size = max - min + 1;
  const observed = Array.from({ length: size }, () => new Array(size).fill(0));
  const actualCounts = new Array(size).fill(0);
  const predictedCounts = new Array(size).fill(0);

  const bucket = (value) => Math.min(max, Math.max(min, Math.round(value))) - min;

  for (let i = 0; i < actual.length; i += 1) {
    const a = bucket(actual[i]);
    const p = bucket(predicted[i]);
    observed[a][p] += 1;
    actualCounts[a] += 1;
    predictedCounts[p] += 1;
  }

  let numerator = 0;
  let denominator = 0;
  for (let a = 0; a < size; a += 1) {
    for (let p = 0; p < size; p += 1) {
      const weight = ((a - p) ** 2) / ((size - 1) ** 2);
      const expected = (actualCounts[a] * predictedCounts[p]) / actual.length;
      numerator += weight * observed[a][p];
      denominator += weight * expected;
    }
  }
  return denominator === 0 ? 0 : 1 - numerator / denominator;
}

/** Ordinal ranks, used to turn Pearson into Spearman. */
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
 * Score a set of essays and collect raw (unstandardised) vectors.
 *
 * The corpus essays carry a prompt name rather than full prompt text. Passing
 * it as the topic still matters: without any topic the prompt-overlap and
 * task-compliance features are constant across every essay, which silently
 * removed two of the four position signals from the fit and drove the position
 * trait to a nonsense negative weight.
 */
function evaluateEssays(essays, label) {
  const rows = [];
  const targets = [];
  const traitList = [];

  essays.forEach((essay, index) => {
    const text = essay.text ?? essay.body;
    const topic = essay.prompt ? { statement: essay.prompt, taskType: 'statement' } : null;
    const features = extractFeatures(text, topic);
    const traits = scoreTraits(features);
    rows.push(buildVector(features, traits));
    targets.push(essay.score ?? essay.officialScore);
    traitList.push({ traits, features, essay });
    if (index % 500 === 0) process.stdout.write(`  ${label}: ${index}/${essays.length}\r`);
  });

  return { rows, targets, traitList };
}

/** Column means and population standard deviations. */
function columnStats(rows) {
  const width = rows[0].length;
  const means = new Array(width).fill(0);
  const stdDevs = new Array(width).fill(0);

  for (const row of rows) for (let i = 0; i < width; i += 1) means[i] += row[i];
  for (let i = 0; i < width; i += 1) means[i] /= rows.length;

  for (const row of rows) for (let i = 0; i < width; i += 1) stdDevs[i] += (row[i] - means[i]) ** 2;
  for (let i = 0; i < width; i += 1) stdDevs[i] = Math.sqrt(stdDevs[i] / rows.length);

  return { means, stdDevs };
}

/**
 * Check the structure detectors against human annotations.
 *
 * PERSUADE marks Counterclaim and Rebuttal spans by hand. If our
 * concede-and-rebut detector is real, essays humans annotated with those spans
 * should fire it far more often than essays without.
 */
function validateDetectors(traitList) {
  let withSpan = { total: 0, fired: 0 };
  let withoutSpan = { total: 0, fired: 0 };
  let positionWith = { total: 0, fired: 0 };
  let positionWithout = { total: 0, fired: 0 };

  for (const { features, essay } of traitList) {
    const types = new Set((essay.discourse ?? []).map((span) => span.type));
    const humanCounter = types.has('Counterclaim') || types.has('Rebuttal');
    const target = humanCounter ? withSpan : withoutSpan;
    target.total += 1;
    if (features.concedeAndRebutParagraphs > 0 || features.concessionCount > 0) target.fired += 1;

    const humanPosition = types.has('Position');
    const positionTarget = humanPosition ? positionWith : positionWithout;
    positionTarget.total += 1;
    if (features.stanceStrength > 0) positionTarget.fired += 1;
  }

  const rate = (x) => (x.total === 0 ? 0 : (100 * x.fired) / x.total);
  return {
    concessionRecall: rate(withSpan),
    concessionFalseRate: rate(withoutSpan),
    positionRecall: rate(positionWith),
    positionFalseRate: rate(positionWithout),
  };
}

async function main() {
  console.log('Loading corpora...');
  const train = await loadJson('corpus-train.json');
  const test = await loadJson('corpus-test.json');
  const ets = await loadJson('calibration.json');

  console.log(`Scoring ${train.length} training essays...`);
  const trainSet = evaluateEssays(train, 'train');
  console.log(`Scoring ${test.length} held-out essays...   `);
  const testSet = evaluateEssays(test, 'test');

  // Standardise using training statistics only, then fit on the training split.
  const { means, stdDevs } = columnStats(trainSet.rows);
  const withBias = (row) => [...standardise(row, means, stdDevs), 1];

  const coefficients = ridgeFit(trainSet.rows.map(withBias), trainSet.targets);
  const predictRaw = (row) => withBias(row).reduce((sum, value, i) => sum + value * coefficients[i], 0);

  const testPredictions = testSet.rows.map(predictRaw);
  const testMae = testPredictions.reduce((sum, p, i) => sum + Math.abs(p - testSet.targets[i]), 0) / testPredictions.length;
  const testQwk = quadraticWeightedKappa(testSet.targets, testPredictions);
  const testR = pearson(testSet.targets, testPredictions);

  console.log('\n--- Held-out performance (PERSUADE scale) ---');
  console.log(`  essays        ${testSet.targets.length}`);
  console.log(`  MAE           ${testMae.toFixed(3)}`);
  console.log(`  QWK           ${testQwk.toFixed(3)}`);
  console.log(`  Pearson r     ${testR.toFixed(3)}`);
  console.log(`  within 0.5    ${(100 * testPredictions.filter((p, i) => Math.abs(p - testSet.targets[i]) <= 0.5).length / testPredictions.length).toFixed(1)}%`);
  console.log(`  within 1.0    ${(100 * testPredictions.filter((p, i) => Math.abs(p - testSet.targets[i]) <= 1.0).length / testPredictions.length).toFixed(1)}%`);

  const detectors = validateDetectors(testSet.traitList);
  console.log('\n--- Structure detectors vs human annotation ---');
  console.log(`  concede/rebut fires on essays humans annotated Counterclaim/Rebuttal: ${detectors.concessionRecall.toFixed(1)}%`);
  console.log(`  ...and on essays they did not:                                       ${detectors.concessionFalseRate.toFixed(1)}%`);
  console.log(`  stance detector fires where humans annotated a Position:             ${detectors.positionRecall.toFixed(1)}%`);
  console.log(`  ...and where they did not:                                           ${detectors.positionFalseRate.toFixed(1)}%`);

  // Anchor onto the ETS scale using ETS's own scored samples.
  const etsSet = evaluateEssays(ets, 'ets');
  const etsRaw = etsSet.rows.map(predictRaw);
  const etsActual = etsSet.targets;

  const meanRaw = etsRaw.reduce((a, b) => a + b, 0) / etsRaw.length;
  const meanActual = etsActual.reduce((a, b) => a + b, 0) / etsActual.length;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < etsRaw.length; i += 1) {
    covariance += (etsRaw[i] - meanRaw) * (etsActual[i] - meanActual);
    variance += (etsRaw[i] - meanRaw) ** 2;
  }
  const slope = variance === 0 ? 1 : covariance / variance;
  const intercept = meanActual - slope * meanRaw;

  console.log('\n--- ETS anchoring ---');
  let etsMaxError = 0;
  const anchored = [];
  etsRaw.forEach((raw, i) => {
    const predicted = slope * raw + intercept;
    anchored.push(predicted);
    const error = Math.abs(predicted - etsActual[i]);
    etsMaxError = Math.max(etsMaxError, error);
    console.log(`  official ${etsActual[i]}  predicted ${predicted.toFixed(2)}  error ${error.toFixed(2)}`);
  });
  // Rank order across the ETS levels. With one essay per level, a tiny
  // inversion between adjacent levels is sampling noise rather than evidence
  // the scorer is broken, so the gate measures Spearman rank correlation and
  // the size of the worst inversion instead of demanding strict monotonicity.
  const strictlyMonotonic = anchored.every((value, i) => i === 0 || value > anchored[i - 1]);
  let worstInversion = 0;
  for (let i = 1; i < anchored.length; i += 1) {
    if (anchored[i] < anchored[i - 1]) {
      worstInversion = Math.max(worstInversion, anchored[i - 1] - anchored[i]);
    }
  }
  const etsSpearman = pearson(
    rankOf(etsActual),
    rankOf(anchored)
  );

  console.log(`  slope ${slope.toFixed(3)}  intercept ${intercept.toFixed(3)}`);
  console.log(`  max error ${etsMaxError.toFixed(2)}   strictly monotonic: ${strictlyMonotonic}`);
  console.log(`  Spearman ${etsSpearman.toFixed(3)}   worst inversion ${worstInversion.toFixed(2)}`);

  // Band width from held-out error, expressed on the ETS scale.
  const bandHalfWidth = Math.max(0.5, Math.round(testMae * Math.abs(slope) * 2) / 2);

  // Report which signals the model actually leans on. On standardised inputs
  // the coefficients are directly comparable.
  const ranked = VECTOR_KEYS
    .map((key, i) => ({ key, weight: coefficients[i] }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  console.log('\n--- Strongest signals ---');
  for (const { key, weight } of ranked.slice(0, 12)) {
    console.log(`  ${weight >= 0 ? '+' : '-'}${Math.abs(weight).toFixed(3)}  ${key}`);
  }

  const module = `// Fitted parameters for the holistic score.
//
// Generated by scripts/calibrate.mjs. Do not hand-tune.
//
// Fitted on ${trainSet.targets.length} human-scored argumentative essays (PERSUADE 2.0),
// held-out test of ${testSet.targets.length}. The affine anchor maps that fitted scale onto
// ETS's own using ETS's published scored samples, because PERSUADE is grade
// 6-12 writing on a different rubric and its 1-6 is not ETS's 1-6.

export const VECTOR_MEANS = [
${means.map((v) => `  ${v.toFixed(6)},`).join('\n')}
];

export const VECTOR_STD_DEVS = [
${stdDevs.map((v) => `  ${v.toFixed(6)},`).join('\n')}
];

export const COEFFICIENTS = [
${coefficients.map((v) => `  ${v.toFixed(6)},`).join('\n')}
];

// predicted = slope * blended + intercept
export const ETS_ANCHOR = {
  slope: ${slope.toFixed(6)},
  intercept: ${intercept.toFixed(6)},
};

// Half the width of the reported band, derived from held-out error rather than
// chosen to look confident.
export const BAND_HALF_WIDTH = {
  heuristicOnly: ${bandHalfWidth.toFixed(2)},
  withAi: ${Math.max(0.5, bandHalfWidth - 0.25).toFixed(2)},
};

export const CALIBRATION_META = {
  fittedAt: ${JSON.stringify(new Date().toISOString().slice(0, 10))},
  trainSize: ${trainSet.targets.length},
  testSize: ${testSet.targets.length},
  testMae: ${testMae.toFixed(4)},
  testQwk: ${testQwk.toFixed(4)},
  testPearson: ${testR.toFixed(4)},
  etsMaxError: ${etsMaxError.toFixed(3)},
  etsSpearman: ${etsSpearman.toFixed(3)},
  etsStrictlyMonotonic: ${strictlyMonotonic},
  etsWorstInversion: ${worstInversion.toFixed(3)},
};
`;

  // Gates. These are deliberately strict: a permissive gate that waves through
  // a weak model is worse than no gate, because the app then reports confident
  // scores it has not earned.
  const failures = [];
  if (testQwk < 0.75) failures.push(`Held-out QWK ${testQwk.toFixed(3)} is below 0.75.`);
  if (etsSpearman < 0.9) failures.push(`ETS rank correlation ${etsSpearman.toFixed(3)} is below 0.90.`);
  if (worstInversion > 0.4) failures.push(`Worst ETS rank inversion ${worstInversion.toFixed(2)} exceeds 0.40.`);
  if (etsMaxError > 0.8) failures.push(`Worst ETS anchor error ${etsMaxError.toFixed(2)} exceeds 0.80.`);
  if (bandHalfWidth > 1.0) {
    failures.push(`Prediction band would be plus or minus ${bandHalfWidth.toFixed(2)} points, which is too wide to be useful.`);
  }
  // Sanity check the signs we know in advance. A scorer that rewards
  // misspellings is broken no matter how good its aggregate agreement looks.
  for (const [key, expected] of Object.entries(EXPECTED_SIGNS)) {
    const weight = coefficients[VECTOR_KEYS.indexOf(key)];
    if (weight === undefined) continue;
    if (Math.abs(weight) < 0.01) continue; // Too small to have a meaningful sign.
    if (Math.sign(weight) !== expected) {
      failures.push(
        `Feature "${key}" fitted with the wrong sign (${weight.toFixed(3)}, expected ${expected > 0 ? 'positive' : 'negative'}).`
      );
    }
  }

  if (failures.length > 0) {
    console.error('\nCalibration FAILED, weights not written:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  await writeFile(path.join(process.cwd(), 'lib', 'scoring', 'weights.mjs'), module, 'utf8');
  console.log('\nCalibration passed. Wrote lib/scoring/weights.mjs');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
