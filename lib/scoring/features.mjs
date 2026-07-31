// Feature extraction. Everything measurable about an essay lands here; the
// trait scorers consume these numbers and never touch raw text.

import {
  paragraphs, sentences, words, rawWords, syllables, stats, mtld, overlapRatio, clamp,
} from './text.mjs';
import {
  STOP_WORDS, STANCE_MARKERS, QUALIFIERS, ABSOLUTES, EXAMPLE_MARKERS, REASON_MARKERS,
  CONCESSION_MARKERS, REBUTTAL_MARKERS, TRANSITION_MARKERS, CONCLUSION_MARKERS,
  SUBORDINATORS, FILLER, ACADEMIC_WORDS, toPhrasePattern,
} from './lexicon.mjs';
import { findMisspellings } from './spelling.mjs';
import { detectConcessionMoves, detectStance } from './structure.mjs';

// A GRE Issue essay should land around 500 to 600 words. Length is credited up
// to the cap and not beyond; words past the threshold count against the essay.
const TARGET_WORDS = 600;

const EXAMPLE_RE = toPhrasePattern(EXAMPLE_MARKERS);
const REASON_RE = toPhrasePattern(REASON_MARKERS);
const CONCESSION_RE = toPhrasePattern(CONCESSION_MARKERS);
const REBUTTAL_RE = toPhrasePattern(REBUTTAL_MARKERS);
const TRANSITION_RE = toPhrasePattern(TRANSITION_MARKERS);
const CONCLUSION_RE = toPhrasePattern(CONCLUSION_MARKERS);
const SUBORDINATOR_RE = toPhrasePattern(SUBORDINATORS);
const QUALIFIER_RE = toPhrasePattern(QUALIFIERS);
const ABSOLUTE_RE = toPhrasePattern(ABSOLUTES);
const FILLER_RE = toPhrasePattern(FILLER);

const countMatches = (text, regex) => {
  regex.lastIndex = 0;
  return (text.match(regex) ?? []).length;
};

/** Proper nouns: capitalised tokens that are not sentence initial. */
function properNouns(text) {
  const found = new Set();
  for (const sentence of sentences(text)) {
    const tokens = sentence.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
    tokens.slice(1).forEach((token) => {
      if (/^[A-Z][a-z]{2,}$/.test(token) && !STOP_WORDS.has(token.toLowerCase())) found.add(token);
    });
  }
  return [...found];
}

/** Mechanics problems that a spell checker will not catch. */
function mechanicsIssues(text, essaySentences) {
  const issues = [];
  const add = (type, detail) => issues.push({ type, detail });

  for (const sentence of essaySentences) {
    const wordCount = (sentence.match(/\S+/g) ?? []).length;

    // Comma splice: independent clause, comma, pronoun or article, verb.
    if (/,\s*(?:it|he|she|they|we|i|you|this|that|these|those)\s+(?:is|are|was|were|has|have|had|will|would|can|could|do|does|did|says?|makes?|takes?)\b/i.test(sentence)) {
      add('comma-splice', sentence.slice(0, 90));
    }
    // Run-on: long sentence with several coordinators and no subordination.
    if (wordCount > 45 && (sentence.match(/\band\b|\bbut\b|\bso\b/gi) ?? []).length >= 3) {
      add('run-on', sentence.slice(0, 90));
    }
    // Fragment: short, no finite verb anywhere.
    if (wordCount >= 3 && wordCount < 12 &&
        !/\b(?:is|are|was|were|be|been|am|has|have|had|do|does|did|can|could|will|would|shall|should|may|might|must)\b/i.test(sentence) &&
        !/\b\w+(?:ed|es|s)\b/i.test(sentence)) {
      add('fragment', sentence.slice(0, 90));
    }
    if (/\bits\s+(?:a|an|the|not|been|going|important|clear)\b/i.test(sentence)) add('its-vs-its', sentence.slice(0, 90));
    if (/\bit's\s+(?:own|value|purpose|effect|role|impact)\b/i.test(sentence)) add('its-vs-its', sentence.slice(0, 90));
    if (/\bthere\s+(?:own|opinion|argument|view|belief)\b/i.test(sentence)) add('there-vs-their', sentence.slice(0, 90));
    if (/\bthey're\s+(?:own|argument|view)\b/i.test(sentence)) add('there-vs-their', sentence.slice(0, 90));
    if (/\b(?:could|would|should)\s+of\b/i.test(sentence)) add('could-of', sentence.slice(0, 90));
    if (/\balot\b/i.test(sentence)) add('alot', sentence.slice(0, 90));
    // Lowercase sentence opening.
    if (/^[a-z]/.test(sentence)) add('capitalisation', sentence.slice(0, 90));
  }

  // Missing space after punctuation, as in "master.To".
  const spacing = (text.match(/[.,;:!?][A-Za-z]/g) ?? []).length;
  for (let i = 0; i < spacing; i += 1) add('punctuation-spacing', null);

  return issues;
}

/**
 * Extract every feature the trait scorers need.
 *
 * `topic` is optional. When supplied, prompt-relevance and task-compliance
 * features become available; without it those degrade to neutral.
 */
export function extractFeatures(essayText, topic = null) {
  const text = essayText.replace(/\r\n/g, '\n').trim();
  const paras = paragraphs(text);
  const essaySentences = sentences(text);
  const tokens = words(text);
  const wordCount = tokens.length;

  const safeDivide = (numerator, denominator) => (denominator === 0 ? 0 : numerator / denominator);
  const per100 = (count) => safeDivide(count * 100, wordCount);

  // Paragraph shape.
  const paragraphWordCounts = paras.map((p) => words(p).length);
  const bodyParagraphs = paras.slice(1, Math.max(1, paras.length - 1));

  // Sentence shape.
  const sentenceLengths = essaySentences.map((s) => (s.match(/\S+/g) ?? []).length);
  const sentenceStats = stats(sentenceLengths);
  // Opener variety is length-confounded (a four sentence essay almost always
  // has four distinct openers). Measuring it over a fixed window was tried and
  // made both agreement and ETS ordering worse, so the raw ratio stands and the
  // fit is left to weigh it.
  const openers = essaySentences.map((s) => (s.match(/[A-Za-z']+/) ?? [''])[0].toLowerCase());
  const openerVariety = safeDivide(new Set(openers).size, openers.length);

  // Lexis.
  const contentTokens = tokens.filter((t) => !STOP_WORDS.has(t));
  const academicHits = tokens.filter((t) => ACADEMIC_WORDS.has(t)).length;
  const longWords = tokens.filter((t) => syllables(t) >= 3).length;
  const names = properNouns(text);
  const numerals = (text.match(/\b\d[\d,.%]*\b/g) ?? []).length;

  // Repetition: how often the single most-used content word appears.
  const frequency = new Map();
  for (const token of contentTokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  const topRepetition = safeDivide(Math.max(0, ...frequency.values()), Math.max(1, contentTokens.length));

  // Redundancy: the share of three-word sequences the essay repeats. This is
  // what padding looks like numerically. Without it, a writer can inflate any
  // length-sensitive signal simply by restating the same point.
  const trigrams = new Map();
  for (let i = 0; i + 2 < tokens.length; i += 1) {
    const key = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
    trigrams.set(key, (trigrams.get(key) ?? 0) + 1);
  }
  let repeatedTrigrams = 0;
  for (const count of trigrams.values()) if (count > 1) repeatedTrigrams += count - 1;
  const redundancy = safeDivide(repeatedTrigrams, Math.max(1, trigrams.size));

  // Structural markers.
  const firstParagraph = paras[0] ?? '';
  const lastParagraph = paras.length > 1 ? paras[paras.length - 1] : '';

  const stance = detectStance(text);
  const stanceStrength = stance.strength;

  // Concession and rebuttal come from the sentence-level detector in
  // structure.mjs. The earlier paragraph-scoped version required both halves of
  // the move in one paragraph and recalled under a third of the concede-and-
  // rebut moves human raters had annotated.
  const moves = detectConcessionMoves(text);
  const concessionCount = moves.concessions.length;
  const rebuttalCount = moves.rebuttals.length;
  const concedeAndRebutParagraphs = moves.completeMoves.length;

  // Paragraphs that open with a transition, a proxy for signposting.
  const signpostedParagraphs = paras.filter((p) => {
    const opening = p.slice(0, 60);
    TRANSITION_RE.lastIndex = 0;
    return TRANSITION_RE.test(opening);
  }).length;

  // Development: does each body paragraph carry both a reason and an example?
  const bodyDevelopment = bodyParagraphs.map((paragraph) => ({
    words: words(paragraph).length,
    reasons: countMatches(paragraph, REASON_RE),
    examples: countMatches(paragraph, EXAMPLE_RE),
    names: properNouns(paragraph).length,
    numerals: (paragraph.match(/\b\d[\d,.%]*\b/g) ?? []).length,
  }));
  const developedBodyParagraphs = bodyDevelopment.filter(
    (p) => p.reasons >= 1 && (p.examples >= 1 || p.names >= 1 || p.numerals >= 1)
  ).length;

  // Relevance to the prompt, and drift between paragraphs.
  let promptOverlap = 0;
  let thesisDrift = 0;
  let taskCompliance = 1;
  if (topic) {
    const promptWords = words(`${topic.statement} ${topic.claim ?? ''} ${topic.reason ?? ''}`);
    promptOverlap = overlapRatio(tokens, promptWords, STOP_WORDS);

    const overlaps = paras.map((p) => overlapRatio(words(p), promptWords, STOP_WORDS));
    thesisDrift = overlaps.length === 0 ? 0 : overlaps.filter((o) => o < 0.05).length / overlaps.length;

    taskCompliance = taskComplianceScore(text, topic);
  }

  // Conventions.
  const misspellings = findMisspellings(text);
  const issues = mechanicsIssues(text, essaySentences);
  const issueCounts = issues.reduce((acc, issue) => ({ ...acc, [issue.type]: (acc[issue.type] ?? 0) + 1 }), {});

  return {
    wordCount,

    // Effective length: words that carry distinct content, credited up to the
    // target and flat thereafter.
    //
    // Four shapes were measured against the padding test. Monotonic log length
    // predicted best but let padding buy half a point. A symmetric tent killed
    // padding and wrecked accuracy, since it wrongly treats a 200 word essay as
    // equivalent to a 900 word one. Rising-then-flat still paid, because most
    // corpus essays sit below the cap and padding walks them up to it.
    //
    // Discounting by redundancy is what finally separates the two: restating a
    // sentence adds words but no distinct content, so effective length barely
    // moves, while a writer who genuinely develops a further point gains fully.
    lengthAdequacy: Math.log1p(Math.min(wordCount * (1 - Math.min(redundancy, 0.85)), TARGET_WORDS)),
    redundancy,

    paragraphCount: paras.length,
    bodyParagraphCount: bodyParagraphs.length,
    paragraphWordCounts,
    // Capped for the same reason as lengthAdequacy: past the length a GRE essay
    // should be, more sentences are not more quality.
    sentenceCount: essaySentences.length,

    // Position
    stanceStrength,
    qualifierCount: per100(countMatches(text, QUALIFIER_RE)),
    absoluteCount: per100(countMatches(text, ABSOLUTE_RE)),
    stanceInFirstParagraph: stance.inFirstParagraph,
    promptOverlap,
    taskCompliance,
    hasConclusion: countMatches(lastParagraph, CONCLUSION_RE) > 0,

    // Development
    reasonMarkersPer100: per100(countMatches(text, REASON_RE)),
    exampleMarkersPer100: per100(countMatches(text, EXAMPLE_RE)),
    properNounCount: names.length,
    properNounsPer100: per100(names.length),
    numeralCount: Math.min(numerals, 8),
    developedBodyParagraphs,
    developedBodyRatio: safeDivide(developedBodyParagraphs, Math.max(1, bodyParagraphs.length)),
    meanBodyParagraphWords: -Math.abs(Math.min(stats(bodyDevelopment.map((p) => p.words)).mean, 400) - 130) / 50,

    // Organisation
    concessionCount: Math.min(concessionCount, 4),
    rebuttalCount: Math.min(rebuttalCount, 5),
    concedeAndRebutParagraphs: Math.min(concedeAndRebutParagraphs, 3),
    signpostedParagraphs,
    signpostRatio: safeDivide(signpostedParagraphs, Math.max(1, paras.length)),
    thesisDrift,
    paragraphBalance: 1 - clamp(safeDivide(stats(paragraphWordCounts).stdDev, Math.max(1, stats(paragraphWordCounts).mean)), 0, 1),

    // Language
    meanSentenceLength: sentenceStats.mean,
    sentenceLengthStdDev: sentenceStats.stdDev,
    openerVariety,
    subordinatorsPer100: per100(countMatches(text, SUBORDINATOR_RE)),
    lexicalDiversity: mtld(tokens),
    academicWordsPer100: per100(academicHits),
    longWordRatio: safeDivide(longWords, wordCount),
    fillerPer100: per100(countMatches(text, FILLER_RE)),
    topWordRepetition: topRepetition,

    // Conventions
    misspellingCount: misspellings.length,
    misspellingsPer100: per100(misspellings.length),
    mechanicsIssueCount: issues.length,
    mechanicsIssuesPer100: per100(issues.length),
    issueCounts,

    // Carried through for explanations rather than scoring.
    // The move detector's evidence, so feedback can quote the actual sentences
    // rather than asserting a verdict the writer cannot check.
    danglingConcessionCount: moves.danglingConcessions.length,
    moves,

    detail: {
      misspellings: misspellings.slice(0, 25),
      issues: issues.slice(0, 25),
      properNouns: names.slice(0, 25),
      paragraphWordCounts,
    },
  };
}

/**
 * How well the response obeys the specific task directions.
 *
 * This is the requirement writers most often miss: a two-view prompt demands
 * that both views be addressed, a claim-and-reason prompt demands that the
 * reason be engaged, and a policy prompt demands consequences.
 */
function taskComplianceScore(text, topic) {
  const lower = text.toLowerCase();

  switch (topic.taskType) {
    case 'two-views': {
      const addressesOpposing = /\b(?:others?|the (?:second|other|opposing|latter|former) view|those who (?:believe|argue|claim)|opponents|the first view)\b/i.test(text);
      const contrasts = /\b(?:whereas|by contrast|in contrast|on the other hand|conversely)\b/i.test(text);
      return 0.4 + (addressesOpposing ? 0.35 : 0) + (contrasts ? 0.25 : 0);
    }
    case 'claim-reason': {
      const reasonWords = topic.reason ? words(topic.reason) : [];
      const engagesReason = reasonWords.length === 0
        ? 0.5
        : overlapRatio(words(text), reasonWords, STOP_WORDS);
      const namesReason = /\b(?:the reason|this reasoning|the rationale|the premise|the justification|because the)\b/i.test(text);
      return clamp(0.35 + engagesReason * 0.8 + (namesReason ? 0.2 : 0), 0, 1);
    }
    case 'policy': {
      const consequences = /\b(?:consequence|result in|lead to|outcome|effect|impact|would cause|side effect|unintended)\b/i.test(lower);
      const implementation = /\b(?:implement|adopt|enact|put into practice|carry out|in practice)\b/i.test(lower);
      return 0.4 + (consequences ? 0.35 : 0) + (implementation ? 0.25 : 0);
    }
    case 'recommendation': {
      const circumstances = /\b(?:circumstance|situation|context|case|when|where|scenario|condition)\b/i.test(lower);
      const bothDirections = /\b(?:would not be|might not be|except|unless|only when|fails? when)\b/i.test(lower);
      return 0.4 + (circumstances ? 0.3 : 0) + (bothDirections ? 0.3 : 0);
    }
    case 'claim': {
      // This instruction explicitly asks for the strongest counterarguments.
      const counters = countMatches(text, CONCESSION_RE) > 0;
      const rebuts = countMatches(text, REBUTTAL_RE) > 0;
      return 0.4 + (counters ? 0.35 : 0) + (rebuts ? 0.25 : 0);
    }
    default: {
      const bothWays = /\b(?:might not|may not|would not|except|unless|on the other hand|however)\b/i.test(lower);
      return 0.55 + (bothWays ? 0.45 : 0);
    }
  }
}
