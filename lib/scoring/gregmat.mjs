// The GregMat structure checklist.
//
// Reported separately from the ETS score on purpose. This is a strategy for
// producing a well-organised essay under time pressure, not a rubric, and
// conflating the two would tell writers that ETS requires five paragraphs.
// It does not. What ETS rewards is a clear position developed and organised
// well, and this structure is a reliable way to get there.
//
// Every check returns the evidence behind it so the writer can disagree.

import { paragraphs, words, sentences } from './text.mjs';
import { detectConcessionMoves, detectStance } from './structure.mjs';

const TARGET_MIN_WORDS = 500;
const TARGET_MAX_WORDS = 600;

/** A single checklist item. */
const check = (id, label, passed, detail, evidence = null) => ({ id, label, passed, detail, evidence });

export function checkStructure(essayText, topic = null) {
  const text = essayText.trim();
  const paras = paragraphs(text);
  const wordCount = words(text).length;
  const stance = detectStance(text);
  const moves = detectConcessionMoves(text);

  const first = paras[0] ?? '';
  const last = paras.length > 1 ? paras[paras.length - 1] : '';
  const body = paras.slice(1, Math.max(1, paras.length - 1));

  const items = [];

  // 1. Five paragraphs: intro, two support, one concede and rebut, conclusion.
  items.push(
    check(
      'shape',
      'Five paragraphs',
      paras.length === 5,
      paras.length === 5
        ? 'Intro, two support, one concession, conclusion.'
        : `You wrote ${paras.length} paragraph${paras.length === 1 ? '' : 's'}. The target shape is five: intro, two support, one concede and shut down, conclusion.`,
      { paragraphCount: paras.length, wordsPerParagraph: paras.map((p) => words(p).length) }
    )
  );

  // 2. A committed stance in the intro, not a fence-sitting summary.
  const strongStance = stance.inFirstParagraph && stance.strength >= 0.7;
  items.push(
    check(
      'stance',
      'Clear stance up front',
      strongStance,
      stance.inFirstParagraph
        ? strongStance
          ? 'Your position is stated in the opening paragraph.'
          : 'There is a position in the opening, but it reads tentatively. Commit to mostly agreeing or mostly disagreeing.'
        : 'No clear position in the opening paragraph. Say which side you are on before you start arguing.',
      { strength: Number(stance.strength.toFixed(2)), inIntro: stance.inFirstParagraph }
    )
  );

  // 3. Qualified rather than absolute. "Mostly agree" beats "always true".
  const qualified = /\b(?:largely|mostly|broadly|generally|for the most part|to a great extent|in most cases|with important exceptions|primarily|on the whole|by and large)\b/i.test(first);
  items.push(
    check(
      'qualified',
      'Position is qualified',
      qualified,
      qualified
        ? 'You qualified your position rather than claiming it holds absolutely.'
        : 'Qualify the position. "I largely agree" is more defensible than an absolute claim, and it sets up the concession paragraph.',
      null
    )
  );

  // 4 and 5. Two body paragraphs that actually support with examples.
  const supported = body.filter((paragraph) => {
    const hasExample = /\b(?:for example|for instance|consider|such as|in \d{4}|take the case)\b/i.test(paragraph);
    const hasName = (paragraph.match(/\b[A-Z][a-z]{3,}\b/g) ?? []).length >= 2;
    const hasReason = /\b(?:because|since|therefore|thus|as a result|which means|this means)\b/i.test(paragraph);
    return hasReason && (hasExample || hasName);
  }).length;

  items.push(
    check(
      'support',
      'Two supported body paragraphs',
      supported >= 2,
      supported >= 2
        ? `${supported} body paragraphs carry both a reason and concrete support.`
        : `Only ${supported} body paragraph${supported === 1 ? '' : 's'} pair a reason with a concrete example. Each support paragraph needs both.`,
      { supportedParagraphs: supported, bodyParagraphs: body.length }
    )
  );

  // 6. The concede-and-shut-down move.
  const completed = moves.completeMoves.length > 0;
  const dangling = moves.danglingConcessions.length;
  items.push(
    check(
      'concede',
      'Concede, then shut it down',
      completed,
      completed
        ? `You concede a point and then take the ground back${dangling > 0 ? `, though ${dangling} other concession${dangling === 1 ? ' is' : 's are'} left standing.` : '.'}`
        : dangling > 0
          ? 'You concede a point but never rebut it. An unanswered concession hands the argument to the other side.'
          : 'No concession paragraph found. Grant the strongest opposing point, then explain why it does not overturn your position.',
      {
        completed: moves.completeMoves.map((m) => ({ concession: m.concession.text.slice(0, 160), rebuttal: m.rebuttal.text.slice(0, 160), form: m.form })),
        dangling: moves.danglingConcessions.map((c) => c.text.slice(0, 160)),
      }
    )
  );

  // 7. A conclusion that does more than restate.
  const hasConclusion = paras.length > 1 &&
    /\b(?:in conclusion|to conclude|in sum|in summary|ultimately|on balance|for these reasons|in the final analysis|taken together)\b/i.test(last);
  items.push(
    check(
      'conclusion',
      'Conclusion present',
      hasConclusion,
      hasConclusion
        ? 'Your closing paragraph signals itself as a conclusion.'
        : 'No clear conclusion. Restate the position and say why it matters.',
      null
    )
  );

  // 8. Length in the band a 30 minute essay should hit.
  const rightLength = wordCount >= TARGET_MIN_WORDS && wordCount <= TARGET_MAX_WORDS;
  items.push(
    check(
      'length',
      `${TARGET_MIN_WORDS} to ${TARGET_MAX_WORDS} words`,
      rightLength,
      rightLength
        ? `${wordCount} words, in the target band.`
        : wordCount < TARGET_MIN_WORDS
          ? `${wordCount} words. Below about ${TARGET_MIN_WORDS} there is rarely room to develop two reasons and a concession.`
          : `${wordCount} words. Past about ${TARGET_MAX_WORDS} you are spending time you do not have, and length alone earns nothing here.`,
      { wordCount }
    )
  );

  // Task-specific demand, which is the requirement writers most often miss.
  if (topic) {
    const demand = taskDemand(text, topic);
    if (demand) items.push(demand);
  }

  const passed = items.filter((i) => i.passed).length;

  return {
    items,
    passed,
    total: items.length,
    // Not a score. It is a checklist completion figure and is labelled as one.
    completion: Math.round((100 * passed) / items.length),
  };
}

/** The extra thing this particular task type asks for. */
function taskDemand(text, topic) {
  switch (topic.taskType) {
    case 'two-views': {
      const both = /\b(?:others?|the (?:second|other|opposing|latter|former) view|those who|the first view)\b/i.test(text) &&
        /\b(?:whereas|by contrast|in contrast|on the other hand|conversely|while)\b/i.test(text);
      return check('task', 'Both views addressed', both,
        both ? 'You engage both of the views the prompt presents.'
             : 'This prompt presents two views and requires you to address both, not only the one you side with.');
    }
    case 'claim-reason': {
      const engaged = /\b(?:the reason|this reasoning|the rationale|the premise|the justification|the stated reason)\b/i.test(text);
      return check('task', 'The reason engaged', engaged,
        engaged ? 'You address the reason the claim rests on, not just the claim.'
                : 'This prompt gives a claim AND a reason. You must address the reason as well; agreeing with the claim while rejecting its reason is a strong move.');
    }
    case 'policy': {
      const consequences = /\b(?:consequence|result in|lead to|outcome|effect|impact|unintended|side effect)\b/i.test(text);
      return check('task', 'Consequences discussed', consequences,
        consequences ? 'You discuss what implementing the policy would actually produce.'
                     : 'This prompt asks for your view on a policy, which means discussing its likely consequences, not just whether it sounds right.');
    }
    case 'recommendation': {
      const circumstances = /\b(?:circumstance|situation|context|when|where|unless|except|only if)\b/i.test(text);
      return check('task', 'Circumstances described', circumstances,
        circumstances ? 'You describe circumstances where the recommendation would and would not hold.'
                      : 'This prompt asks for specific circumstances in which the recommendation would and would not be advantageous.');
    }
    case 'claim': {
      const counters = detectConcessionMoves(text).completeMoves.length > 0;
      return check('task', 'Strongest counterargument addressed', counters,
        counters ? 'You take on a challenge to your own position, as this prompt requires.'
                 : 'This prompt explicitly asks you to address the most compelling reasons that could challenge your position.');
    }
    default:
      return null;
  }
}

/** Sentence-level evidence for the writing view to highlight. */
export function structureEvidence(essayText) {
  const moves = detectConcessionMoves(essayText);
  const stance = detectStance(essayText);
  return {
    stanceIndex: stance.index,
    concessions: moves.concessions.map((c) => ({ index: c.index, length: c.length, kind: c.kind })),
    rebuttals: moves.rebuttals.map((r) => ({ index: r.index, length: r.length, kind: r.kind })),
    sentenceCount: sentences(essayText).length,
  };
}
