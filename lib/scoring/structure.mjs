// Structural move detection: stance, concession, and rebuttal.
//
// These drive the GregMat structure panel, so they are held to a higher bar
// than the statistical features. If the app tells a writer they never conceded
// anything, it had better be true.
//
// Two design decisions, both from measuring against human annotation:
//
//   Detection is sentence level, not paragraph level. An earlier paragraph
//   scoped version required a concession marker and a pivot in the same
//   paragraph and recalled only a third of human-annotated Counterclaims.
//
//   A single sentence can contain the whole move. "Although some argue that X,
//   Y" concedes and rebuts in one breath, and it is one of the most common
//   forms of the move in real writing.

import { paragraphs } from './text.mjs';
import { STANCE_MARKERS } from './lexicon.mjs';

/** Sentences with their offsets in the original text. */
function sentencesWithOffsets(text) {
  const out = [];
  const pattern = /[^.!?\n]+(?:[.!?]+|\n|$)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (trimmed.length < 2) continue;
    out.push({ text: trimmed, index: match.index + (raw.length - raw.trimStart().length), length: trimmed.length });
  }
  return out;
}

// Attribution of a view to someone else. This is the workhorse: most real
// concessions are "some people say X" rather than "admittedly, X".
const ATTRIBUTION = /\b(?:some|many|others?|a few|certain|most)\s+(?:people|students|critics|opponents|readers|experts|scientists|teachers|parents|individuals|americans|adults)?\s*(?:may|might|could|would|will|do|can)?\s*(?:say|argue|believe|think|claim|contend|feel|state|insist|assert|suggest|maintain|point out|worry|fear|object)\b/i;

const ATTRIBUTION_SHORT = /\b(?:critics|opponents|skeptics|sceptics|detractors|naysayers|proponents|supporters)\s+(?:may|might|could|would|will|do|often)?\s*(?:say|argue|believe|think|claim|contend|insist|assert|maintain|counter|object)\b/i;

const IMPERSONAL_ATTRIBUTION = /\b(?:it (?:is|has been|could be|can be|may be|might be) (?:argued|said|claimed|suggested|contended|objected)|one (?:could|might|may|can) (?:say|argue|claim|object|contend)|there are (?:those|people|some) who|a common (?:objection|criticism|argument|counterargument)|the (?:counterargument|opposing view|other side|opposition))\b/i;

// A quantifier followed closely by a hypothetical modal. This catches the
// commonest plain-English concession, "others may not have time" or "some kids
// might not try out", where the verb is ordinary and unlistable. Restricted to
// may/might/could/would because those carry the hypothetical sense; "should"
// and "will" would sweep in the writer's own assertions.
// The quantifier has to be the subject of the modal, within a couple of words.
// A 45 character window let "Without the cooperation of others, his invention
// might never have..." register as a concession.
const QUANTIFIED_HYPOTHETICAL = /\b(?:some|many|others?|certain|most|a few|those|several)\s+(?:\w+\s+){0,2}?(?:may|might|could|would)\s+(?:not\s+)?[a-z]+\b/i;

// The writer granting the other side's view in their own voice.
const ACKNOWLEDGEMENT = /\b(?:i|we) (?:can |could |do )?(?:understand|know|see|realize|realise|recognize|recognise|acknowledge|admit|get) (?:that|why|where|how|the)\b/i;

// Second and third person hypotheticals, another very common plain form.
const HYPOTHETICAL_VIEW = /\b(?:you|they|people|kids|students|parents|teachers|others|someone|somebody) (?:may|might|could|would)(?: not)? (?:think|say|feel|believe|argue|claim|find|have|want|see|disagree|object)\b/i;

const THOSE_WHO = /\b(?:those|people|students|kids|anyone|everyone) who (?:think|thinks|believe|believes|say|says|argue|argues|feel|feels|disagree|disagrees|oppose|opposes)\b/i;

// Concessive subordinators. When one of these opens a clause it marks the
// concession directly.
// Concessive subordinators.
//
// "while" and "though" are split out and required to govern a finite clause.
// Used loosely they are continuative rather than concessive, and "cooperation
// is needed, while still adhering to social standards" is not a concession.
const CONCESSIVE_CLAUSE_STRICT = /(?:^|[.!?]\s+|,\s*)(?:although|even though|whereas|despite the fact|in spite of the fact|granted that|admittedly|even if|no doubt|true,|it is true|it may be true|it is certainly true)\b/i;

const CONCESSIVE_WHILE = /(?:^|[.!?]\s+|,\s*)(?:while|whilst|though)\s+(?:\w+\s+){0,3}?(?:is|are|was|were|do|does|did|can|could|may|might|will|would|has|have|had|seems?|appears?)\b/i;

const CONCESSIVE_CLAUSE = new RegExp(
  `${CONCESSIVE_CLAUSE_STRICT.source}|${CONCESSIVE_WHILE.source}`,
  'i'
);

const CONCESSIVE_HEDGE = /\b(?:at first (?:glance|blush)|on the surface|it (?:may|might|would) seem|seemingly|on the one hand|there is (?:some|certainly some|admittedly some) (?:merit|truth|force))\b/i;

// Contrastive pivots that take the ground back.
//
// Matched anywhere in the sentence, not only at its start. Requiring the pivot
// to open a clause missed the single commonest form of the move in plain
// writing, "some say X but Y" without a comma, and held complete-move recall
// near a third.
const CONTRASTIVE = /\b(?:however|nevertheless|nonetheless|yet|but|still|even so|that said|despite this|in spite of this|regardless|on the contrary|in reality|in truth|conversely|then again|although|though)\b/i;

// Pivots strong enough to count on their own, used where a bare "but" would be
// too weak to trust.
const STRONG_CONTRASTIVE = /\b(?:however|nevertheless|nonetheless|even so|that said|despite this|in spite of this|on the contrary|in reality|in truth|conversely)\b/i;

// Explicit refutation, which counts as a rebuttal wherever it appears.
const REFUTATION = /\b(?:overlooks?|ignores?|fails? to (?:account|consider|recognize|recognise|address|grasp)|misses? the point|is (?:mistaken|wrong|flawed|misguided|incorrect|unpersuasive)|does not (?:follow|hold|withstand|account)|do not (?:follow|hold|withstand)|proves too much|this (?:reasoning|argument|objection|view|claim) (?:fails|collapses|breaks down|is)|what (?:they|critics|this) (?:forget|forgets|overlook|overlooks|miss|misses)|the (?:flaw|problem|trouble|weakness) (?:with|in) (?:this|that|such))\b/i;

const CONCESSION_ONLY_HEDGE = /\b(?:i (?:will |do )?(?:concede|admit|acknowledge|grant)|to be sure|to be fair|granted)\b/i;

/**
 * Find concessions, rebuttals, and completed concede-and-rebut moves.
 *
 * A completed move is either a concession sentence followed within a short
 * window by a pivot, or a single sentence that does both.
 */
export function detectConcessionMoves(text, { window = 4 } = {}) {
  const sentences = sentencesWithOffsets(text);

  const concessions = [];
  const rebuttals = [];

  sentences.forEach((sentence, position) => {
    const value = sentence.text;

    // Strong signals name someone else's view outright, so they mark a
    // concession on their own.
    const strong =
      ATTRIBUTION.test(value) ||
      ATTRIBUTION_SHORT.test(value) ||
      IMPERSONAL_ATTRIBUTION.test(value) ||
      ACKNOWLEDGEMENT.test(value) ||
      THOSE_WHO.test(value);

    const concessive = CONCESSIVE_CLAUSE.test(value) || CONCESSIVE_HEDGE.test(value) || CONCESSION_ONLY_HEDGE.test(value);

    // Weak signals are ambiguous. "Some students would benefit from sport" is
    // the writer's own claim, not a concession, and treating every quantified
    // hypothetical as a concession dropped precision by a third. These only
    // count when the writer actually pivots away from them, which is what
    // makes a sentence a concession rather than an assertion.
    const weak = QUANTIFIED_HYPOTHETICAL.test(value) || HYPOTHETICAL_VIEW.test(value);

    if (strong || concessive || weak) {
      concessions.push({
        ...sentence,
        position,
        kind: strong ? 'attributed-view' : concessive ? 'concessive-clause' : 'hypothetical',
        requiresPivot: !strong && !concessive,
      });
    }

    // A pivot only counts as a rebuttal if it is not itself the concession
    // opener, so "Although X" does not register as its own rebuttal.
    const contrastive = CONTRASTIVE.test(value);
    const refutes = REFUTATION.test(value);
    if (contrastive || refutes) {
      rebuttals.push({ ...sentence, position, kind: refutes ? 'refutation' : 'contrastive' });
    }
  });

  const completeMoves = [];
  const confirmedConcessions = [];

  for (const concession of concessions) {
    // Case 1: the sentence concedes and rebuts on its own.
    // "Although some argue X, Y" or "Some say X, but Y".
    //
    // The pivot has to come after the concession opener, otherwise "But some
    // people say X" would count as a completed move when it concedes only.
    const openerEnd = Math.max(
      concession.text.search(ATTRIBUTION),
      concession.text.search(ATTRIBUTION_SHORT),
      concession.text.search(CONCESSIVE_CLAUSE),
      concession.text.search(QUANTIFIED_HYPOTHETICAL),
      concession.text.search(ACKNOWLEDGEMENT),
      concession.text.search(HYPOTHETICAL_VIEW),
      concession.text.search(THOSE_WHO),
      0
    );
    const afterOpener = concession.text.slice(openerEnd + 1);
    const selfContained = CONTRASTIVE.test(afterOpener) || REFUTATION.test(concession.text);

    if (selfContained) {
      confirmedConcessions.push(concession);
      completeMoves.push({ concession, rebuttal: concession, distance: 0, form: 'single-sentence' });
      continue;
    }

    // Case 2: a pivot lands within the next few sentences.
    const pivot = rebuttals.find(
      (rebuttal) => rebuttal.position > concession.position && rebuttal.position - concession.position <= window
    );
    if (pivot) {
      confirmedConcessions.push(concession);
      completeMoves.push({
        concession,
        rebuttal: pivot,
        distance: pivot.position - concession.position,
        form: 'across-sentences',
      });
      continue;
    }

    // No pivot. Only the unambiguous signals survive as concessions.
    if (!concession.requiresPivot) confirmedConcessions.push(concession);
  }

  // Which paragraphs contain a completed move, for the structure panel.
  const paras = paragraphs(text);
  const paragraphOffsets = [];
  let cursor = 0;
  for (const paragraph of paras) {
    const start = text.indexOf(paragraph, cursor);
    paragraphOffsets.push({ start, end: start + paragraph.length });
    cursor = start + paragraph.length;
  }
  const paragraphsWithMove = new Set();
  for (const move of completeMoves) {
    const which = paragraphOffsets.findIndex((p) => move.concession.index >= p.start && move.concession.index < p.end);
    if (which >= 0) paragraphsWithMove.add(which);
  }

  return {
    concessions: confirmedConcessions,
    rebuttals,
    completeMoves,
    paragraphsWithMove: [...paragraphsWithMove],
    // A concession the writer never took back. GregMat treats this as worse
    // than not conceding at all: it hands the point to the other side.
    danglingConcessions: confirmedConcessions.filter(
      (concession) => !completeMoves.some((move) => move.concession.index === concession.index)
    ),
  };
}

/** Locate the writer's stated position and how committed it is. */
export function detectStance(text) {
  const paras = paragraphs(text);
  const firstParagraph = paras[0] ?? '';

  let strength = 0;
  let index = -1;
  let inFirstParagraph = false;

  for (const { pattern, weight } of STANCE_MARKERS) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (weight > strength) {
      strength = weight;
      index = match.index;
    }
    if (pattern.test(firstParagraph)) inFirstParagraph = true;
  }

  // A position stated only late is worth less than a thesis up front.
  if (strength > 0 && !inFirstParagraph) strength *= 0.6;

  return { strength, index, inFirstParagraph };
}
