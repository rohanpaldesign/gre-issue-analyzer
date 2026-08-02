// The feature vector used to predict the holistic score.
//
// Architecture note. Traits and holistic score have different jobs, so they are
// computed differently:
//
//   The five trait scores are interpretable formulas (traits.mjs). They drive
//   the feedback, so they must be explainable sentence by sentence.
//
//   The holistic score is a ridge regression over this richer vector. Squeezing
//   every signal through five trait numbers first threw away most of the
//   information and capped agreement with human raters well below what the
//   features support.
//
// Traits are deliberately NOT in this vector. An earlier version included both
// the raw features and the trait scores computed from those same features. The
// two are collinear by construction, so the regression split credit between
// them arbitrarily and handed the conventions trait a negative weight while
// giving misspellings its correct negative weight. Overall accuracy was fine;
// the individual signs were meaningless. Raw features predict, traits explain.

export const FEATURE_KEYS = [
  // Size and shape. Every signal here is padding-invariant by construction:
  // lengthAdequacy peaks at the target length rather than rising with it, and
  // redundancy rises when a writer restates themselves. Raw counts that scale
  // with duplication were removed or capped, because the fit will otherwise
  // find whichever one is left and reward waffle through it.
  // Redundancy is not listed separately: it is already inside lengthAdequacy,
  // and including both let the fit cancel the padding penalty with a positive
  // standalone weight. It stays available in features for the feedback panel.
  'lengthAdequacy',
  'paragraphCount',
  'paragraphBalance',
  'meanBodyParagraphWords',

  // Sentence craft.
  'meanSentenceLength',
  'sentenceLengthStdDev',
  // openerVariety is length-confounded: a four sentence essay almost always has
  // four distinct openers, so the ratio is highest on the weakest responses and
  // the fit gives it a negative weight. It is kept because removing it cost
  // more agreement than it bought, and because with the log length curve the
  // padding test stays neutral. Both alternatives were measured.
  'openerVariety',
  'subordinatorsPer100',

  // Lexis.
  'lexicalDiversity',
  'academicWordsPer100',
  'longWordRatio',
  'fillerPer100',
  'topWordRepetition',

  // Argument development.
  'reasonMarkersPer100',
  'exampleMarkersPer100',
  'properNounsPer100',
  'numeralCount',
  'developedBodyRatio',

  // Structure.
  'concedeAndRebutParagraphs',
  'concessionCount',
  'rebuttalCount',
  'signpostRatio',
  'hasConclusionNumeric',

  // Position.
  'stanceStrength',
  'stanceInFirstParagraphNumeric',
  'qualifierCount',
  'absoluteCount',
  'promptOverlap',
  'taskCompliance',
  'thesisDrift',

  // Conventions.
  'misspellingsPer100',
  'mechanicsIssuesPer100',
];

export const VECTOR_KEYS = FEATURE_KEYS;

/**
 * Features whose direction is not in question. If the fit ever gives one of
 * these the wrong sign, something upstream is broken and calibration should
 * refuse to write weights rather than ship a scorer that rewards misspellings.
 */
export const EXPECTED_SIGNS = {
  lengthAdequacy: 1,
  lexicalDiversity: 1,
  academicWordsPer100: 1,
  reasonMarkersPer100: 1,
  taskCompliance: 1,
  misspellingsPer100: -1,
  mechanicsIssuesPer100: -1,
  fillerPer100: -1,
  thesisDrift: -1,
};

/** Flatten features into the fixed-order vector the model expects. */
export function buildVector(features, traits = null) {
  const derived = {
    ...features,
    hasConclusionNumeric: features.hasConclusion ? 1 : 0,
    stanceInFirstParagraphNumeric: features.stanceInFirstParagraph ? 1 : 0,
  };

  return VECTOR_KEYS.map((key) => {
    const value = derived[key];
    return Number.isFinite(value) ? value : 0;
  });
}

/** Apply stored z-score standardisation. */
export function standardise(vector, means, stdDevs) {
  return vector.map((value, i) => {
    const spread = stdDevs[i];
    return spread > 1e-9 ? (value - means[i]) / spread : 0;
  });
}
