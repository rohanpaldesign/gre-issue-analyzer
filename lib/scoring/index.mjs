// Public entry point for scoring an essay.

import { extractFeatures } from './features.mjs';
import { scoreTraits, TRAIT_KEYS, TRAIT_LABELS } from './traits.mjs';
import { buildVector, standardise, VECTOR_KEYS } from './vector.mjs';
import { checkStructure } from './gregmat.mjs';
import { applyLengthCeiling, effectiveWordCount } from './ceiling.mjs';
import {
  VECTOR_MEANS, VECTOR_STD_DEVS, COEFFICIENTS, ETS_ANCHOR, BAND_HALF_WIDTH, CALIBRATION_META,
} from './weights.mjs';

/** Snap to the half point grid ETS actually reports on. */
const toGrid = (value) => Math.round(Math.min(6, Math.max(1, value)) * 2) / 2;


/**
 * Score an essay.
 *
 * Returns the five ETS trait scores, a holistic prediction expressed as a band
 * rather than a point, the GregMat structure checklist, and the evidence behind
 * every one of them.
 */
export function scoreEssay(essayText, topic = null) {
  const text = (essayText ?? '').trim();

  if (text.split(/\s+/).filter(Boolean).length < 25) {
    return {
      tooShort: true,
      message: 'Write at least 25 words before scoring. There is nothing to judge yet.',
    };
  }

  const features = extractFeatures(text, topic);
  const traits = scoreTraits(features);

  const standardised = standardise(buildVector(features), VECTOR_MEANS, VECTOR_STD_DEVS);
  const raw = [...standardised, 1].reduce((sum, value, i) => sum + value * COEFFICIENTS[i], 0);
  const modelled = Math.min(6, Math.max(1, ETS_ANCHOR.slope * raw + ETS_ANCHOR.intercept));

  const effectiveWords = effectiveWordCount(features);
  const { score: holistic, note: lengthNote } = applyLengthCeiling(modelled, effectiveWords);

  const half = BAND_HALF_WIDTH.heuristicOnly;

  return {
    tooShort: false,
    holistic: toGrid(holistic),
    lengthCeiling: lengthNote,
    band: {
      low: toGrid(holistic - half),
      high: toGrid(holistic + half),
      halfWidth: half,
      // Stated plainly rather than dressed up. Leave-one-out error is quoted
      // because in-sample error against the same essays the anchor was fitted
      // on flatters the result, which is how an over-rating scorer once passed.
      basis: `Fitted on ${CALIBRATION_META.trainSize.toLocaleString()} human-scored essays and anchored on ${CALIBRATION_META.etsAnchors} that ETS scored itself. Held-out error against those averages ${CALIBRATION_META.looMae ?? CALIBRATION_META.etsMae} of a point, so treat this as a rough reading rather than a grade.`,
    },
    traits: TRAIT_KEYS.map((key) => ({
      key,
      label: TRAIT_LABELS[key],
      score: Math.round(traits[key] * 10) / 10,
    })),
    structure: checkStructure(text, topic),
    features: publicFeatures(features),
    calibration: CALIBRATION_META,
  };
}

/** The subset of features worth showing a writer, with the raw detail. */
function publicFeatures(f) {
  return {
    wordCount: f.wordCount,
    paragraphCount: f.paragraphCount,
    sentenceCount: f.sentenceCount,
    meanSentenceLength: Math.round(f.meanSentenceLength * 10) / 10,
    sentenceLengthStdDev: Math.round(f.sentenceLengthStdDev * 10) / 10,
    lexicalDiversity: Math.round(f.lexicalDiversity),
    academicWordsPer100: Math.round(f.academicWordsPer100 * 100) / 100,
    misspellings: f.detail.misspellings,
    misspellingsPer100: Math.round(f.misspellingsPer100 * 100) / 100,
    mechanicsIssues: f.detail.issues,
    properNouns: f.detail.properNouns,
    redundancy: Math.round(f.redundancy * 1000) / 1000,
    concessions: f.concessionCount,
    completeMoves: f.concedeAndRebutParagraphs,
    danglingConcessions: f.danglingConcessionCount,
  };
}

export { TRAIT_KEYS, TRAIT_LABELS };
