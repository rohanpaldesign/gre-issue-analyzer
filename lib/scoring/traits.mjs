// The five ETS rubric dimensions, scored 1 to 6.
//
// Each trait is an explicit, interpretable formula over features rather than a
// learned black box, because the app has to justify every score it gives. Only
// the blend weights that combine traits into a holistic score are fitted; see
// weights.mjs and scripts/calibrate.mjs.
//
// Anchors are ascending raw values mapping onto rubric points 1 to 6.

import { scaleToRubric, clamp } from './text.mjs';

const weightedAverage = (parts) => {
  const total = parts.reduce((sum, [, weight]) => sum + weight, 0);
  if (total === 0) return 1;
  return parts.reduce((sum, [value, weight]) => sum + value * weight, 0) / total;
};

/**
 * Position and task response.
 * ETS: "articulates a clear and insightful position in accordance with the
 * assigned task."
 */
export function scorePosition(f) {
  // A committed stance stated up front. Fence-sitting is the failure mode the
  // rubric and GregMat both punish, so an unstated position caps this low.
  const stance = scaleToRubric(f.stanceStrength, [0, 0.2, 0.45, 0.65, 0.85, 1.0]);

  // Qualified positions read as more thoughtful than absolute ones, but only
  // to a point: hedging everything is its own failure.
  const qualification = scaleToRubric(
    f.qualifierCount - Math.max(0, f.absoluteCount - 2) * 0.5,
    [-2, 0, 0.5, 1.5, 3, 5]
  );

  const onTopic = scaleToRubric(f.promptOverlap, [0, 0.05, 0.12, 0.2, 0.3, 0.45]);
  const taskDirections = scaleToRubric(f.taskCompliance, [0.3, 0.45, 0.6, 0.75, 0.88, 1.0]);

  const base = weightedAverage([
    [stance, 0.32],
    [onTopic, 0.24],
    [taskDirections, 0.30],
    [qualification, 0.14],
  ]);

  // A position stated only in the conclusion is not a thesis.
  const penalty = f.stanceInFirstParagraph ? 0 : 0.4;
  return clamp(base - penalty, 1, 6);
}

/**
 * Development.
 * ETS: "develops the position fully, with compelling reasons and/or persuasive
 * examples."
 */
export function scoreDevelopment(f) {
  // Length is not quality, but under-development is the single most common
  // reason the ETS samples cite for a low score, and it shows up as brevity.
  const substance = scaleToRubric(f.wordCount, [90, 175, 280, 380, 500, 650]);

  const reasoning = scaleToRubric(f.reasonMarkersPer100, [0, 0.5, 1.0, 1.6, 2.4, 3.5]);
  const illustration = scaleToRubric(
    f.exampleMarkersPer100 + f.properNounsPer100 * 0.6 + Math.min(f.numeralCount, 6) * 0.15,
    [0, 0.4, 0.9, 1.6, 2.6, 4.0]
  );

  // Whether each body paragraph actually carries a reason plus support, rather
  // than the essay carrying one good paragraph and three thin ones.
  const perParagraph = scaleToRubric(f.developedBodyRatio, [0, 0.2, 0.4, 0.6, 0.8, 1.0]);
  const paragraphDepth = scaleToRubric(f.meanBodyParagraphWords, [20, 45, 70, 95, 125, 165]);

  return clamp(
    weightedAverage([
      [substance, 0.24],
      [reasoning, 0.22],
      [illustration, 0.24],
      [perParagraph, 0.18],
      [paragraphDepth, 0.12],
    ]),
    1,
    6
  );
}

/**
 * Focus and organisation.
 * ETS: "sustains a well-focused, well-organized analysis, connecting ideas
 * logically."
 */
export function scoreOrganization(f) {
  // Five paragraphs is the target shape: intro, two support, one concede and
  // rebut, conclusion. Three is thin, one is unstructured, nine is scattered.
  const shape = f.paragraphCount <= 1
    ? 1
    : scaleToRubric(-Math.abs(f.paragraphCount - 5), [-4, -3, -2, -1.2, -0.5, 0]);

  const signposting = scaleToRubric(f.signpostRatio, [0, 0.15, 0.3, 0.45, 0.6, 0.8]);

  // The concede-and-shut-down move. Counted only when a concession is followed
  // by a pivot in the same paragraph, so conceding without recovering earns
  // nothing.
  const counterargument = scaleToRubric(
    f.concedeAndRebutParagraphs * 2 + Math.min(f.concessionCount, 3) * 0.5 + Math.min(f.rebuttalCount, 4) * 0.4,
    [0, 0.8, 1.6, 2.6, 3.6, 5]
  );

  const focus = scaleToRubric(1 - f.thesisDrift, [0.3, 0.5, 0.7, 0.85, 0.95, 1.0]);
  const balance = scaleToRubric(f.paragraphBalance, [0, 0.25, 0.45, 0.6, 0.75, 0.9]);
  const closing = f.hasConclusion ? 6 : 3;

  return clamp(
    weightedAverage([
      [shape, 0.22],
      [signposting, 0.18],
      [counterargument, 0.24],
      [focus, 0.16],
      [balance, 0.10],
      [closing, 0.10],
    ]),
    1,
    6
  );
}

/**
 * Language and fluency.
 * ETS: "conveys ideas fluently and precisely, using effective vocabulary and
 * sentence variety."
 */
export function scoreLanguage(f) {
  // Variety, not length. A uniform run of 18-word sentences reads flat.
  const variety = scaleToRubric(f.sentenceLengthStdDev, [1.5, 3.5, 5.5, 7.5, 9.5, 12]);
  const sentenceLength = scaleToRubric(
    -Math.abs(f.meanSentenceLength - 20),
    [-14, -10, -7, -4.5, -2.5, 0]
  );
  const openers = scaleToRubric(f.openerVariety, [0.25, 0.4, 0.55, 0.68, 0.8, 0.9]);
  const complexity = scaleToRubric(f.subordinatorsPer100, [0, 1.0, 2.0, 3.0, 4.2, 6.0]);
  const diversity = scaleToRubric(f.lexicalDiversity, [25, 40, 55, 70, 85, 105]);
  const register = scaleToRubric(f.academicWordsPer100, [0, 0.6, 1.3, 2.1, 3.0, 4.5]);
  const cleanliness = scaleToRubric(
    -(f.fillerPer100 + f.topWordRepetition * 40),
    [-6, -4.2, -3.0, -2.0, -1.2, -0.4]
  );

  return clamp(
    weightedAverage([
      [variety, 0.18],
      [sentenceLength, 0.10],
      [openers, 0.14],
      [complexity, 0.14],
      [diversity, 0.16],
      [register, 0.16],
      [cleanliness, 0.12],
    ]),
    1,
    6
  );
}

/**
 * Conventions.
 * ETS: "demonstrates superior facility with the conventions of standard written
 * English, but may have minor errors."
 *
 * The rubric is explicit that minor errors are compatible with a 6 and that
 * errors matter when they "interfere with meaning", so the curve is forgiving
 * at the top and steep once errors become frequent.
 */
export function scoreConventions(f) {
  const spelling = scaleToRubric(-f.misspellingsPer100, [-6, -3.5, -2.0, -1.1, -0.5, -0.05]);
  const mechanics = scaleToRubric(-f.mechanicsIssuesPer100, [-5, -3.2, -2.0, -1.2, -0.6, -0.1]);

  // Errors that obscure meaning are weighted above cosmetic ones.
  const severe = (f.issueCounts['run-on'] ?? 0) + (f.issueCounts['comma-splice'] ?? 0) + (f.issueCounts.fragment ?? 0);
  const severity = scaleToRubric(-severe, [-8, -5, -3, -1.6, -0.6, 0]);

  return clamp(
    weightedAverage([
      [spelling, 0.42],
      [mechanics, 0.33],
      [severity, 0.25],
    ]),
    1,
    6
  );
}

/** All five traits at once. */
export function scoreTraits(features) {
  return {
    position: scorePosition(features),
    development: scoreDevelopment(features),
    organization: scoreOrganization(features),
    language: scoreLanguage(features),
    conventions: scoreConventions(features),
  };
}

export const TRAIT_KEYS = ['position', 'development', 'organization', 'language', 'conventions'];

export const TRAIT_LABELS = {
  position: 'Position and task response',
  development: 'Development',
  organization: 'Focus and organisation',
  language: 'Language and fluency',
  conventions: 'Conventions',
};
