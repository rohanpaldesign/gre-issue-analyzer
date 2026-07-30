// Spell checking without a runtime dependency.
//
// The bundled list holds hunspell stems only, so inflected forms like
// "running" or "societies" are absent by design. Rather than expand the list,
// we strip inflections back to a candidate stem and look that up. This keeps
// the asset small and, more importantly, keeps behaviour identical between the
// calibration script and the deployed scorer.

import zlib from 'node:zlib';
import { WORDLIST_GZIP_BASE64 } from './wordlist-data.mjs';

let cachedWords = null;

function dictionary() {
  if (cachedWords) return cachedWords;
  const text = zlib.gunzipSync(Buffer.from(WORDLIST_GZIP_BASE64, 'base64')).toString('utf8');
  cachedWords = new Set(text.split('\n'));
  return cachedWords;
}

// Words that essays legitimately use but a stem list will not contain.
const ALLOWED = new Set([
  'ok', 'okay', 'internet', 'online', 'website', 'email', 'smartphone', 'smartphones',
  'workplace', 'lifelong', 'wellbeing', 'multitask', 'multitasking', 'counterargument',
  'counterarguments', 'socioeconomic', 'policymaker', 'policymakers', 'stakeholder',
  'stakeholders', 'coursework', 'dataset', 'datasets', 'ecommerce', 'startup', 'startups',
  'mindset', 'mindsets', 'skillset', 'timeframe', 'healthcare', 'workforce', 'worldview',
  'lifestyle', 'upskill', 'reskilling', 'gig', 'burnout', 'wifi', 'app', 'apps', 'blog',
  'blogs', 'podcast', 'podcasts', 'meme', 'memes', 'crowdsourcing', 'gentrification',
]);

const DOUBLE_CONSONANT = /([bcdfghjklmnpqrstvwxz])\1$/;

/** Candidate stems for a possibly inflected form. */
function candidates(word) {
  const out = [word];
  const push = (value) => {
    if (value && value.length > 1) out.push(value);
  };

  // Possessives.
  if (word.endsWith("'s") || word.endsWith('’s')) push(word.slice(0, -2));

  // Plurals and third person singular.
  if (word.endsWith('ies')) push(`${word.slice(0, -3)}y`);
  if (word.endsWith('es')) {
    push(word.slice(0, -2));
    push(word.slice(0, -1));
  }
  if (word.endsWith('s')) push(word.slice(0, -1));

  // Past tense and progressive.
  for (const suffix of ['ed', 'ing']) {
    if (!word.endsWith(suffix)) continue;
    const trimmed = word.slice(0, -suffix.length);
    push(trimmed);
    push(`${trimmed}e`);
    if (DOUBLE_CONSONANT.test(trimmed)) push(trimmed.slice(0, -1));
    if (trimmed.endsWith('i')) push(`${trimmed.slice(0, -1)}y`);
  }

  // Adverbs, comparatives, superlatives, common nominalisations.
  for (const [suffix, replacements] of [
    ['ly', ['', 'e']],
    ['er', ['', 'e']],
    ['est', ['', 'e']],
    ['ness', ['', 'y']],
    ['ment', ['']],
    ['ful', ['']],
    ['less', ['']],
  ]) {
    if (!word.endsWith(suffix)) continue;
    const trimmed = word.slice(0, -suffix.length);
    for (const replacement of replacements) push(trimmed + replacement);
    if (suffix === 'ly' && trimmed.endsWith('i')) push(`${trimmed.slice(0, -1)}y`);
    if ((suffix === 'ness' || suffix === 'est' || suffix === 'er') && trimmed.endsWith('i')) {
      push(`${trimmed.slice(0, -1)}y`);
    }
  }

  return out;
}

/** True if the token is a recognisable English word. */
export function isKnownWord(token) {
  const word = token.toLowerCase().replace(/^[-']+|[-']+$/g, '');
  if (word.length === 0) return true;
  if (word.length === 1) return 'aioy'.includes(word);
  if (ALLOWED.has(word)) return true;

  const dict = dictionary();
  if (dict.has(word)) return true;

  // Hyphenated compounds are fine if both halves are.
  if (word.includes('-')) {
    const parts = word.split('-').filter(Boolean);
    if (parts.length > 1 && parts.every((part) => isKnownWord(part))) return true;
  }

  return candidates(word).some((candidate) => dict.has(candidate));
}

/**
 * Find misspellings in an essay.
 *
 * Capitalised words that are not sentence initial are treated as proper nouns
 * and skipped: an essay citing "Semmelweis" or "Wikipedia" should not be
 * punished for it, and the development scorer wants those names anyway.
 */
export function findMisspellings(text) {
  const misspelled = [];
  const seen = new Set();

  // Track which token positions start a sentence so we do not excuse a
  // capitalised word that is only capitalised because it opens a sentence.
  const sentenceStarts = new Set();
  let index = 0;
  for (const chunk of text.split(/(?<=[.!?])\s+/)) {
    sentenceStarts.add(index);
    index += (chunk.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).length;
  }

  const tokens = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  tokens.forEach((token, position) => {
    const isCapitalised = /^[A-Z]/.test(token);
    if (isCapitalised && !sentenceStarts.has(position)) return;
    if (/^[A-Z]{2,}$/.test(token)) return;

    if (isKnownWord(token)) return;
    const key = token.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    misspelled.push(token);
  });

  return misspelled;
}
