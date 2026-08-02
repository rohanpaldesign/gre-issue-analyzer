// The current ETS "Analyze an Issue" scoring guide, verbatim.
//
// Kept in one place so the AI rater in app/api/analyze and the corpus labeller
// in scripts/label-corpus.mjs judge against exactly the same text. If they
// drift apart, the labels the model is fitted on stop matching the standard the
// app claims to score against.

export const ETS_RUBRIC = `Score 6: presents a cogent, well-articulated analysis of the issue and conveys meaning skillfully. Articulates a clear and insightful position in accordance with the assigned task; develops the position fully with compelling reasons and/or persuasive examples; sustains a well-focused, well-organized analysis, connecting ideas logically; conveys ideas fluently and precisely, using effective vocabulary and sentence variety; demonstrates superior facility with the conventions of standard written English but may have minor errors.
Score 5: presents a generally thoughtful, well-developed analysis and conveys meaning clearly. Clear and well-considered position; logically sound reasons and/or well-chosen examples; focused and generally well organized; conveys ideas clearly and well; facility with conventions, minor errors possible.
Score 4: presents a competent analysis and conveys meaning adequately. Clear position; relevant reasons and/or examples; adequately focused and organized; sufficient control of language for acceptable clarity; generally demonstrates control of conventions but may have some errors.
Score 3: demonstrates some competence but is obviously flawed. Vague or limited in addressing the task or developing a position; weak use of reasons or examples, or relies on unsupported claims; limited focus or organization; problems in language and sentence structure causing a lack of clarity; occasional major or frequent minor errors that can interfere with meaning.
Score 2: serious weaknesses. Unclear or seriously limited in addressing the task; few if any relevant reasons or examples; poorly focused or organized; serious problems in language that frequently interfere with meaning.
Score 1: fundamental deficiencies. Little or no evidence of understanding the issue; little or no ability to develop an organized response; severe language problems that persistently interfere with meaning.`;

// Calibration notes taken from the word counts of ETS's own scored samples.
// Included in the labelling prompt because a rater with no sense of the
// distribution drifts high: without this, competent short responses get read as
// 5s and 6s. These are the real figures from the eleven published essays.
export const ETS_LENGTH_CONTEXT = `For calibration, the word counts of ETS's own published scored samples are: score 1 at 127 words; score 2 at 126 and 303; score 3 at 253 and 331; score 4 at 365 and 398; score 5 at 414 and 541; score 6 at 646 and 935. Length is not a criterion in itself, but a response that never develops two reasons and a counterargument cannot score 5 or 6 no matter how clean its prose is. Score to the rubric, not to the writer's confidence.`;
