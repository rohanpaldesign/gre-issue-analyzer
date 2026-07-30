// Marker vocabularies used by the feature extractor.
//
// These are deliberately explicit rather than learned. The scorer has to be
// able to explain itself ("your third paragraph never concedes anything"), and
// an opaque model cannot do that.

export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these',
  'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'have', 'has', 'had', 'will', 'would', 'shall', 'should', 'can', 'could', 'may',
  'might', 'must', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'as',
  'into', 'from', 'up', 'down', 'out', 'over', 'under', 'it', 'its', 'they', 'them',
  'their', 'we', 'us', 'our', 'you', 'your', 'he', 'she', 'his', 'her', 'him', 'i',
  'my', 'me', 'not', 'no', 'so', 'such', 'there', 'here', 'what', 'which', 'who',
  'whom', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'more', 'most',
  'other', 'some', 'only', 'own', 'same', 'very', 'just', 'also', 'too', 'one', 'two',
]);

/**
 * Stance markers, weighted by how committed the phrasing is.
 *
 * Deliberately wide. An earlier version accepted only formal constructions
 * ("I contend", "I maintain") and fired on 28.7% of essays that human raters
 * had annotated as containing an explicit Position. Most writers state a
 * position perfectly clearly without reaching for that register: "I think",
 * "the best way is", or a bare deontic claim like "schools should".
 */
export const STANCE_MARKERS = [
  // Explicit first-person commitment.
  { pattern: /\bi (?:strongly |firmly |wholeheartedly |completely |totally )?(?:agree|disagree|believe|contend|maintain|hold|argue|submit|assert)\b/i, weight: 1.0 },
  { pattern: /\b(?:i|we) (?:would|must|do) (?:argue|contend|maintain|believe)\b/i, weight: 1.0 },
  { pattern: /\bin my (?:view|opinion|judgment|judgement|estimation|eyes)\b/i, weight: 0.9 },
  { pattern: /\bi (?:think|feel|would say|am convinced|personally)\b/i, weight: 0.8 },
  { pattern: /\bmy (?:position|view|stance|opinion|belief) is\b/i, weight: 0.95 },

  // Verdict on the prompt itself.
  { pattern: /\b(?:the|this) (?:statement|claim|recommendation|policy|assertion|argument|idea|view) is (?:largely |broadly |fundamentally |essentially |mostly |partly )?(?:correct|right|sound|true|valid|mistaken|wrong|flawed|misguided|false|unpersuasive)\b/i, weight: 0.95 },
  { pattern: /\b(?:i|one) (?:agree|disagree)s? (?:with|that)\b/i, weight: 0.95 },
  { pattern: /\b(?:agree|disagree) with (?:the|this) (?:statement|claim|recommendation|policy|assertion|idea|view)\b/i, weight: 0.9 },

  // Framed as a graded judgment, which the task explicitly asks for.
  { pattern: /\bto a (?:great|large|considerable|significant|certain|limited) extent\b/i, weight: 0.85 },
  { pattern: /\b(?:while|although|though) [^.!?]{5,90}, (?:i|the|it|this|ultimately)\b/i, weight: 0.8 },

  // Bare deontic or superlative claims. Common, and unambiguously a position.
  { pattern: /\b(?:schools|students|governments|society|people|teachers|parents|companies|universities|everyone|we|they|you|one) (?:should|must|ought to|need to|needs to|have to|has to)\b/i, weight: 0.7 },
  { pattern: /\bthe best (?:way|approach|method|solution|policy|option|choice) (?:is|would be|to)\b/i, weight: 0.75 },
  { pattern: /\bit is (?:better|best|essential|crucial|vital|important|necessary|wrong|unwise) (?:to|that|for)\b/i, weight: 0.7 },
  { pattern: /\b(?:is|are) (?:more|less) important than\b/i, weight: 0.75 },
  { pattern: /\bthere is no (?:doubt|question) that\b/i, weight: 0.8 },

  // Summative pivots, weakest signal.
  { pattern: /\b(?:ultimately|on balance|all things considered|in the end)\b,?\s/i, weight: 0.55 },
];

/** Qualifiers that signal a graded rather than absolute position. */
export const QUALIFIERS = [
  'largely', 'mostly', 'broadly', 'generally', 'for the most part', 'in the main',
  'to a great extent', 'to a large extent', 'to some extent', 'in most cases',
  'with important exceptions', 'with some qualification', 'primarily', 'chiefly',
  'by and large', 'on the whole',
];

/** Absolutist language, which the rubric treats as less thoughtful. */
export const ABSOLUTES = [
  'always', 'never', 'everyone', 'nobody', 'no one', 'all people', 'every person',
  'without exception', 'in every case', 'completely', 'totally', 'entirely',
  'absolutely', 'undeniably', 'obviously', 'clearly everyone',
];

/** Openers that introduce a supporting example. */
export const EXAMPLE_MARKERS = [
  'for example', 'for instance', 'consider', 'take the case of', 'take, for example',
  'as an illustration', 'to illustrate', 'a case in point', 'such as', 'namely',
  'in the case of', 'witness', 'one need only look at', 'history shows',
  'consider the case', 'look no further than',
];

/** Words that introduce a reason or a causal chain. */
export const REASON_MARKERS = [
  'because', 'since', 'therefore', 'thus', 'hence', 'consequently', 'as a result',
  'which means', 'this means', 'it follows that', 'for this reason', 'accordingly',
  'so that', 'leads to', 'results in', 'gives rise to', 'stems from', 'owing to',
  'due to', 'in turn', 'the reason', 'this is why', 'which explains',
];

/**
 * Concession openers: the writer granting ground to the other side.
 *
 * Includes the plain phrasings ("some people say", "others believe") alongside
 * the formal ones. Restricting this to GRE register missed most real
 * concessions, including ones human raters had annotated as Counterclaims.
 */
export const CONCESSION_MARKERS = [
  // Formal.
  'admittedly', 'granted', 'to be sure', 'it is true that', 'it is certainly true',
  'of course', 'critics might argue', 'critics may argue', 'critics contend',
  'opponents argue', 'opponents might', 'one might object', 'skeptics contend',
  'detractors claim', 'there is some merit', 'those who disagree', 'concededly',
  'it would be naive to deny', 'i concede', 'undoubtedly there are cases',
  'at first glance', 'on the surface', 'proponents of the opposing',
  // Plain.
  'some people say', 'some people believe', 'some people think', 'some people argue',
  'some may say', 'some might say', 'some would say', 'some would argue',
  'some argue', 'some believe', 'some think', 'some claim',
  'others believe', 'others think', 'others say', 'others argue', 'others may',
  'many people believe', 'many people think', 'many believe', 'many think',
  'one could say', 'one could argue', 'you could say', 'you might say',
  'it may seem', 'it might seem', 'it could be argued', 'it can be argued',
  'while some', 'while others', 'although some', 'even though some',
  'there are those who', 'people may argue', 'people might argue',
  'a common objection', 'the counterargument', 'on the one hand',
];

/**
 * Rebuttal pivots: the writer taking that ground back.
 *
 * Bare contrastives like "but" and "still" are included because plain writing
 * relies on them, and the false-positive risk is contained: the organisation
 * scorer only credits a pivot that follows a concession in the same paragraph.
 */
export const REBUTTAL_MARKERS = [
  'however', 'nevertheless', 'nonetheless', 'yet', 'even so', 'that said',
  'but this', 'but the', 'but that', 'but it', 'but they', 'but these',
  'this objection', 'such reasoning', 'this argument fails', 'the flaw in',
  'what this overlooks', 'this overlooks', 'this ignores', 'misses the point',
  'proves too much', 'does not follow', 'on closer inspection', 'closer examination',
  'in reality', 'the problem with this', 'despite this', 'in spite of this',
  'regardless', 'still', 'on the other hand', 'in truth', 'the truth is',
  'this is not', 'that is not', 'this fails', 'what they forget',
  'they overlook', 'this reasoning', 'the issue with',
];

/** Paragraph-opening transitions that signal organisation. */
export const TRANSITION_MARKERS = [
  'first', 'firstly', 'second', 'secondly', 'third', 'thirdly', 'finally',
  'moreover', 'furthermore', 'in addition', 'additionally', 'similarly',
  'likewise', 'by contrast', 'in contrast', 'conversely', 'on the other hand',
  'more importantly', 'perhaps most importantly', 'beyond this', 'another',
  'a second', 'a third', 'the most compelling', 'consider next',
];

/** Conclusion openers. */
export const CONCLUSION_MARKERS = [
  'in conclusion', 'to conclude', 'in sum', 'in summary', 'ultimately',
  'in the final analysis', 'on balance', 'taken together', 'all told',
  'the foregoing', 'for these reasons', 'in short',
];

/** Subordinating conjunctions, a proxy for clause complexity. */
export const SUBORDINATORS = [
  'although', 'though', 'even though', 'whereas', 'while', 'unless', 'until',
  'whenever', 'wherever', 'if', 'once', 'since', 'because', 'before', 'after',
  'as if', 'as though', 'provided that', 'in order that', 'so that', 'given that',
  'insofar as', 'to the extent that',
];

/** Vague intensifiers and filler that dilute academic prose. */
export const FILLER = [
  'very', 'really', 'quite', 'basically', 'actually', 'literally', 'totally',
  'definitely', 'certainly', 'a lot', 'lots of', 'kind of', 'sort of', 'stuff',
  'things', 'good', 'bad', 'nice', 'big', 'huge', 'a bit', 'pretty much',
  'in today\'s world', 'since the dawn of time', 'throughout history',
];

/**
 * Academic and analytical vocabulary. Presence of this register is one of the
 * clearest separators between a 4 and a 6 in the ETS samples.
 */
export const ACADEMIC_WORDS = new Set([
  'analysis', 'analyse', 'analyze', 'approach', 'assume', 'assumption', 'authority',
  'available', 'benefit', 'concept', 'consequence', 'considerable', 'constitute',
  'context', 'contrast', 'contribute', 'create', 'criteria', 'critical', 'cultural',
  'demonstrate', 'derive', 'distinction', 'distinguish', 'dominant', 'economic',
  'element', 'emphasis', 'empirical', 'ensure', 'establish', 'evaluate', 'evidence',
  'exclude', 'factor', 'framework', 'function', 'fundamental', 'furthermore',
  'hypothesis', 'identify', 'ideology', 'implication', 'implement', 'implicit',
  'inevitable', 'inherent', 'initial', 'innovation', 'insight', 'institution',
  'integral', 'interpret', 'intrinsic', 'justify', 'legitimate', 'maintain',
  'mechanism', 'method', 'nevertheless', 'norm', 'objective', 'obtain', 'obvious',
  'occur', 'outcome', 'paradigm', 'perceive', 'perspective', 'phenomenon', 'policy',
  'potential', 'precise', 'predict', 'presume', 'principle', 'prior', 'process',
  'promote', 'proportion', 'pursue', 'rational', 'reinforce', 'reject', 'relevant',
  'reliable', 'require', 'research', 'resolve', 'respective', 'reveal', 'rigorous',
  'scenario', 'scope', 'significant', 'similar', 'specific', 'structure',
  'subsequent', 'substitute', 'sufficient', 'sustain', 'theory', 'thereby',
  'thesis', 'transform', 'ultimately', 'underlying', 'undertake', 'valid', 'vary',
  'virtue', 'whereas', 'widespread', 'yield', 'compelling', 'nuanced', 'systemic',
  'incentive', 'tradeoff', 'threshold', 'causal', 'correlation', 'counterexample',
]);

/** Escape a phrase for use inside a RegExp. */
export function toPhrasePattern(phrases) {
  const escaped = phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
}
