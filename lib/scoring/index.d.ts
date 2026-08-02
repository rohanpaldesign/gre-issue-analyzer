// Types for the scoring engine.
//
// The engine itself is plain JavaScript so that the calibration script and the
// deployed app run byte-identical code with no build step between them. This
// declaration gives the TypeScript side real types without changing that.

export type TopicInput = {
  id?: number;
  statement: string;
  taskInstruction?: string;
  taskType?: string;
  claim?: string | null;
  reason?: string | null;
};

export type TraitScore = {
  key: 'position' | 'development' | 'organization' | 'language' | 'conventions';
  label: string;
  score: number;
};

export type StructureItem = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  evidence: unknown;
};

export type ScoreResult = {
  tooShort: boolean;
  message?: string;
  holistic: number;
  /** Set when the score was held down by the short-response ceiling. */
  lengthCeiling: string | null;
  band: { low: number; high: number; halfWidth: number; basis: string };
  traits: TraitScore[];
  structure: {
    items: StructureItem[];
    passed: number;
    total: number;
    completion: number;
  };
  features: {
    wordCount: number;
    paragraphCount: number;
    sentenceCount: number;
    meanSentenceLength: number;
    sentenceLengthStdDev: number;
    lexicalDiversity: number;
    academicWordsPer100: number;
    misspellings: string[];
    misspellingsPer100: number;
    mechanicsIssues: Array<{ type: string; detail: string | null }>;
    properNouns: string[];
    redundancy: number;
    concessions: number;
    completeMoves: number;
    danglingConcessions: number;
  };
  calibration: Record<string, string | number | boolean | null>;
};

export function scoreEssay(essayText: string, topic?: TopicInput | null): ScoreResult;

export const TRAIT_KEYS: string[];
export const TRAIT_LABELS: Record<string, string>;
