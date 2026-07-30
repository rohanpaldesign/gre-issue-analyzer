// Text primitives shared by every trait scorer.
//
// Deliberately dependency-free: this module runs inside a Next route handler,
// inside the calibration script, and over a 15,000 essay corpus, so it has to
// be fast and portable.

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e',
  'inc', 'ltd', 'co', 'fig', 'approx', 'dept', 'est', 'no', 'vol',
]);

/** Split into paragraphs on blank lines, falling back to single newlines. */
export function paragraphs(text) {
  const byBlankLine = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (byBlankLine.length > 1) return byBlankLine;

  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Split into sentences. Handles the abbreviation and decimal cases that would
 * otherwise inflate sentence counts and wreck the sentence-variety signal.
 */
export function sentences(text) {
  const flattened = text.replace(/\s+/g, ' ').trim();
  if (!flattened) return [];

  const out = [];
  let start = 0;

  for (let i = 0; i < flattened.length; i += 1) {
    const char = flattened[i];
    if (char !== '.' && char !== '!' && char !== '?') continue;

    // Run on through "..." and "?!" so they end one sentence, not three.
    let end = i;
    while (end + 1 < flattened.length && '.!?'.includes(flattened[end + 1])) end += 1;

    const next = flattened[end + 1];
    if (next !== undefined && next !== ' ') continue;

    const afterSpace = flattened[end + 2];
    // A lowercase continuation means the stop was not a real boundary.
    if (afterSpace !== undefined && /[a-z]/.test(afterSpace)) continue;

    if (char === '.') {
      const preceding = flattened.slice(Math.max(0, i - 12), i);
      const lastWord = /([A-Za-z.]+)$/.exec(preceding)?.[1]?.toLowerCase();
      if (lastWord && ABBREVIATIONS.has(lastWord.replace(/\.$/, ''))) continue;
      // Decimal point, as in "3.5".
      if (/\d$/.test(preceding) && /^\d/.test(flattened.slice(end + 1))) continue;
      // Single initial, as in "J. Smith".
      if (/(^|\s)[A-Z]$/.test(preceding)) continue;
    }

    const sentence = flattened.slice(start, end + 1).trim();
    if (sentence) out.push(sentence);
    start = end + 1;
  }

  const tail = flattened.slice(start).trim();
  if (tail) out.push(tail);

  return out;
}

/** Lowercased word tokens. Keeps internal apostrophes and hyphens. */
export function words(text) {
  return (text.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? []).map((w) =>
    w.replace(/^[-']+|[-']+$/g, '')
  ).filter(Boolean);
}

/** Word tokens with original casing, used for proper-noun detection. */
export function rawWords(text) {
  return text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
}

const VOWEL_GROUPS = /[aeiouy]+/g;

/** Approximate syllable count. Good enough for readability-style signals. */
export function syllables(word) {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (clean.length <= 3) return 1;

  const trimmed = clean
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '');

  return Math.max(1, (trimmed.match(VOWEL_GROUPS) ?? []).length);
}

/** Mean and population standard deviation. */
export function stats(values) {
  if (values.length === 0) return { mean: 0, stdDev: 0, min: 0, max: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return {
    mean,
    stdDev: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/**
 * Measure of Textual Lexical Diversity.
 *
 * Chosen over a raw type-token ratio because TTR falls as essays get longer,
 * which would make every long essay look repetitive. MTLD is length-robust.
 */
export function mtld(tokens, threshold = 0.72) {
  if (tokens.length < 20) return tokens.length === 0 ? 0 : new Set(tokens).size;

  const runFactors = (sequence) => {
    let factors = 0;
    let types = new Set();
    let count = 0;

    for (const token of sequence) {
      types.add(token);
      count += 1;
      if (types.size / count <= threshold) {
        factors += 1;
        types = new Set();
        count = 0;
      }
    }
    // Partial trailing factor.
    if (count > 0) {
      const ratio = types.size / count;
      factors += ratio === 1 ? 0 : (1 - ratio) / (1 - threshold);
    }
    return factors === 0 ? sequence.length : sequence.length / factors;
  };

  const forward = runFactors(tokens);
  const backward = runFactors([...tokens].reverse());
  return (forward + backward) / 2;
}

/** Content words shared between two texts, as a fraction of the shorter set. */
export function overlapRatio(aWords, bWords, stopWords) {
  const a = new Set(aWords.filter((w) => !stopWords.has(w) && w.length > 3));
  const b = new Set(bWords.filter((w) => !stopWords.has(w) && w.length > 3));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/** Clamp a value into a range. */
export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Map a raw measurement onto the 1 to 6 rubric scale using anchor points.
 * `anchors` is an ascending list of six raw values; a measurement at or below
 * the first scores 1, at or above the last scores 6, linear in between.
 */
export function scaleToRubric(value, anchors) {
  if (value <= anchors[0]) return 1;
  if (value >= anchors[anchors.length - 1]) return 6;
  for (let i = 1; i < anchors.length; i += 1) {
    if (value <= anchors[i]) {
      const span = anchors[i] - anchors[i - 1];
      const position = span === 0 ? 0 : (value - anchors[i - 1]) / span;
      return i + position;
    }
  }
  return 6;
}
