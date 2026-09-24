import type { Analysis } from './analyse';
import type { SourceCode } from 'eslint';

/**
 * One analysis per linted file, keyed by `context.sourceCode` so every rule
 * reporting on the same file shares a single merge and graph resolution.
 * A `WeakMap` lets the entry go once ESLint drops the `SourceCode`.
 */
const analyses = new WeakMap<SourceCode, Analysis>();

/**
 * The analysis cached for `sourceCode`, running `compute` only when no
 * analysis is cached for that key yet.
 *
 * @param sourceCode - The `context.sourceCode` of the file being linted.
 * @param compute - Produces the analysis on the first call for this key.
 * @returns The one analysis stored for `sourceCode`.
 */
export const cachedAnalysis = (sourceCode: SourceCode, compute: () => Analysis): Analysis => {
  const cached = analyses.get(sourceCode);
  if (cached !== undefined) {
    return cached;
  }
  const analysis = compute();
  analyses.set(sourceCode, analysis);
  return analysis;
};
