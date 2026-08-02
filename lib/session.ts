'use client';

// Sync code handling, client side.
//
// Identity is a code stored in localStorage and typed into any other device you
// want your history on. No password, no auth provider, no email.

const KEY = 'gre-issue-analyzer:sync-code';
const DRAFT_KEY = 'gre-issue-analyzer:draft';

const WORDS = [
  'amber', 'basalt', 'cedar', 'delta', 'ember', 'fjord', 'gable', 'harbor', 'ivory',
  'jasper', 'kelp', 'linen', 'marble', 'nimbus', 'onyx', 'pewter', 'quartz', 'reed',
  'slate', 'thistle', 'umber', 'verdant', 'willow', 'yarrow',
];

function newCode(): string {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${pick()}-${pick()}-${Math.floor(Math.random() * 9000) + 1000}`;
}

/** The current sync code, minting one on first use. */
export function getSyncCode(): string {
  if (typeof window === 'undefined') return '';
  let code = window.localStorage.getItem(KEY);
  if (!code) {
    code = newCode();
    window.localStorage.setItem(KEY, code);
  }
  return code;
}

export function setSyncCode(code: string): string {
  const normalised = code.trim().toLowerCase();
  window.localStorage.setItem(KEY, normalised);
  return normalised;
}

export type Draft = {
  topicId: number;
  essay: string;
  startedAt: number;
  secondsUsed: number;
  timed: boolean;
  assisted: boolean;
  /**
   * Set when this draft is a rework of an earlier attempt. Carried through the
   * draft so a refresh mid-revision resumes into revision mode rather than
   * silently turning into a fresh attempt against the same prompt.
   */
  revisionOf?: string | null;
};

/**
 * Autosave. A 30 minute timed essay lost to a stray refresh would be worse
 * than not having a timer at all.
 */
export function saveDraft(draft: Draft) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function loadDraft(): Draft | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Draft;
  } catch {
    return null;
  }
}

export function clearDraft() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(DRAFT_KEY);
}

/**
 * Small persisted preferences, kept beside the draft helpers.
 *
 * Used for the word count toggle, which defaults to off because the real test
 * interface has no counter.
 */
export function getPreference(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(`gre-issue-analyzer:pref:${key}`);
  return stored === null ? fallback : stored === 'true';
}

export function setPreference(key: string, value: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`gre-issue-analyzer:pref:${key}`, String(value));
}

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function formatDuration(seconds: number): string {
  const clamped = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(clamped / 60);
  return `${String(minutes).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}
