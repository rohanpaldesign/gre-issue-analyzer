import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Free-tier daily quota is per model and small, so the route rotates through
// models rather than failing once the first is exhausted.
const MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-2.0-flash',
];

// The current ETS "Analyze an Issue" scoring guide, given verbatim so the model
// judges against the real rubric rather than a paraphrase of it.
const RUBRIC = `Score 6: presents a cogent, well-articulated analysis of the issue and conveys meaning skillfully. Articulates a clear and insightful position in accordance with the assigned task; develops the position fully with compelling reasons and/or persuasive examples; sustains a well-focused, well-organized analysis, connecting ideas logically; conveys ideas fluently and precisely, using effective vocabulary and sentence variety; demonstrates superior facility with the conventions of standard written English but may have minor errors.
Score 5: presents a generally thoughtful, well-developed analysis and conveys meaning clearly. Clear and well-considered position; logically sound reasons and/or well-chosen examples; focused and generally well organized; conveys ideas clearly and well; facility with conventions, minor errors possible.
Score 4: presents a competent analysis and conveys meaning adequately. Clear position; relevant reasons and/or examples; adequately focused and organized; sufficient control of language for acceptable clarity; generally demonstrates control of conventions but may have some errors.
Score 3: demonstrates some competence but is obviously flawed. Vague or limited in addressing the task or developing a position; weak use of reasons or examples, or relies on unsupported claims; limited focus or organization; problems in language and sentence structure causing a lack of clarity; occasional major or frequent minor errors that can interfere with meaning.
Score 2: serious weaknesses. Unclear or seriously limited in addressing the task; few if any relevant reasons or examples; poorly focused or organized; serious problems in language that frequently interfere with meaning.
Score 1: fundamental deficiencies. Little or no evidence of understanding the issue; little or no ability to develop an organized response; severe language problems that persistently interfere with meaning.`;

const STRUCTURE = `The writer is following this structure: an introduction taking a clear, qualified position (mostly agreeing or mostly disagreeing rather than sitting on the fence), two body paragraphs each developing one supporting reason with a concrete example, one paragraph conceding the strongest opposing point and then shutting it down, and a conclusion. Comment on whether they executed it, but do not treat deviation from it as a rubric failure: ETS does not require five paragraphs.`;

async function callGemini(apiKey: string, prompt: string) {
  let lastStatus = 0;

  for (const model of MODELS) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 8000,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (response.ok) {
      const payload = await response.json();
      const text: string =
        payload.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
      if (!text) continue;
      return { model, data: JSON.parse(text.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim()) };
    }

    lastStatus = response.status;
    // 429 means this model's quota is gone; try the next one.
    if (response.status !== 429 && response.status !== 503) break;
  }

  throw new Error(`No model available (last status ${lastStatus}).`);
}

/**
 * Optional second rater.
 *
 * The heuristic scorer measures surface correlates of quality. It cannot tell a
 * well-reasoned argument from a fluent empty one, which is the one thing a
 * language model can actually do here.
 */
export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { available: false, reason: 'No API key is configured, so the AI rater is off. Everything else works.' },
      { status: 200 }
    );
  }

  let body: { essay?: string; topic?: { statement?: string; taskInstruction?: string } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON.' }, { status: 400 });
  }

  const essay = (body.essay ?? '').trim();
  if (essay.split(/\s+/).length < 25) {
    return NextResponse.json({ error: 'Too short to analyse.' }, { status: 400 });
  }

  const prompt = `You are an experienced GRE Analytical Writing rater. Score this "Analyze an Issue" response against the official ETS scoring guide.

OFFICIAL ETS SCORING GUIDE:
${RUBRIC}

STRUCTURE THE WRITER IS AIMING FOR:
${STRUCTURE}

PROMPT:
${body.topic?.statement ?? '(not supplied)'}
${body.topic?.taskInstruction ?? ''}

RESPONSE:
${essay}

Judge the reasoning, which is what a rubric-based automated scorer cannot do. Is the argument actually sound? Are the examples real and relevant, or vague gestures? Does the concession engage the strongest opposing case or a strawman?

Quote the writer's own words as evidence. Be specific and be honest; an inflated score is useless to someone preparing for a test. No em dashes.

Return ONLY JSON:
{"holistic": 4.5,
 "traits": {"position": 5, "development": 4, "organization": 5, "language": 4, "conventions": 5},
 "summary": "two or three sentences on the response as a whole",
 "strengths": [{"point": "...", "quote": "..."}],
 "weaknesses": [{"point": "...", "quote": "...", "fix": "what to do instead"}],
 "reasoningCritique": "the part a heuristic scorer cannot judge: is the argument sound",
 "nextEssayAdvice": ["one concrete thing to do differently next time"]}`;

  try {
    const { model, data } = await callGemini(apiKey, prompt);
    return NextResponse.json({ available: true, model, ...data });
  } catch (error) {
    return NextResponse.json(
      {
        available: false,
        reason:
          'The free tier quota is used up for now, so the AI rater is unavailable. The rubric score and structure check above are unaffected.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 200 }
    );
  }
}
