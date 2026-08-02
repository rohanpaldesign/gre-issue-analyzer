// Ceilings on what a short response can be reported as.
//
// Shared by the scorer and the calibration script so the gate tests the number
// the product actually shows, not an internal one.
//
// Taken from the word counts of ETS's own published scored samples, not
// invented: score 1 at 127 words; 2 at 126 and 303; 3 at 253 and 331; 4 at 365
// and 398; 5 at 414 and 541; 6 at 646 and 935. Nothing under 400 words has been
// published above a 4, because a response that never develops two reasons and a
// counterargument has not met the task however clean its prose is.
//
// This is doing real work rather than papering over a flaw. The regression is
// fitted on grade 6 to 12 writing, where 380 words is a normal length, so the
// model has no way to learn that 380 words is short for the GRE. The corpus
// cannot supply that knowledge and eleven anchor essays cannot correct a
// whole-distribution shift, so it is encoded explicitly and disclosed in the UI
// whenever it binds.

export const LENGTH_CEILINGS = [
  { underWords: 200, ceiling: 3.0 },
  { underWords: 300, ceiling: 4.0 },
  { underWords: 400, ceiling: 5.0 },
];

/** Effective words: raw length discounted by how much the writer repeats. */
export function effectiveWordCount(features) {
  return features.wordCount * (1 - Math.min(features.redundancy ?? 0, 0.85));
}

/**
 * Apply the ceiling. Returns the score to report and, when the ceiling binds,
 * the reason, so the interface can say why rather than quietly lowering it.
 */
export function applyLengthCeiling(score, effectiveWords) {
  for (const rule of LENGTH_CEILINGS) {
    if (effectiveWords < rule.underWords && score > rule.ceiling) {
      return {
        score: rule.ceiling,
        note: `Held at ${rule.ceiling.toFixed(1)}. This is ${Math.round(effectiveWords)} words of distinct content, and a response that short rarely develops two reasons and a counterargument. ETS has published no sample above a 4 under 400 words.`,
      };
    }
  }
  return { score, note: null };
}
