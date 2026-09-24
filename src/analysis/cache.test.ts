import type { Analysis } from './analyse';
import type { SourceCode } from 'eslint';

import { describe, expect, test } from 'bun:test';

import { cachedAnalysis } from './cache';

/** A distinct stand-in key; the cache only uses its identity. */
const newKey = (): SourceCode => ({}) as SourceCode;

/** A distinct stand-in analysis; the cache only uses its identity. */
const newAnalysis = (): Analysis => ({ opaque: [] }) as unknown as Analysis;

describe('cachedAnalysis', () => {
  test('computes once per key and returns the same analysis after', () => {
    // Arrange
    const key = newKey();
    let calls = 0;
    const compute = (): Analysis => {
      calls += 1;
      return newAnalysis();
    };

    // Act
    const first = cachedAnalysis(key, compute);
    const second = cachedAnalysis(key, compute);

    // Assert
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  test('computes a fresh analysis for a new key', () => {
    // Arrange
    let calls = 0;
    const compute = (): Analysis => {
      calls += 1;
      return newAnalysis();
    };

    // Act
    const first = cachedAnalysis(newKey(), compute);
    const second = cachedAnalysis(newKey(), compute);

    // Assert
    expect(calls).toBe(2);
    expect(second).not.toBe(first);
  });
});
