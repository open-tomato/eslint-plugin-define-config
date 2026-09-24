import type { StepRegistry } from '@open-tomato/define-config';

import { resolve } from 'node:path';

import { createLoader } from '@open-tomato/define-config';
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const HOST_DIR = resolve(import.meta.dir, '../fixtures/host');
const LINT_WALL_TIME_BOUND_MS = 30_000;
const PREFIX = 'define-config/';

/** Unique, sorted values of `codes`. */
const uniqueSorted = (codes: readonly string[]): string[] => [...new Set(codes)].sort();

describe('plugin and loader parity over the host fixture', () => {
  test('reports the same diagnostic codes as the loader, within a loose lint time bound', async () => {
    // Arrange
    const { steps } = await import(resolve(HOST_DIR, 'steps.ts')) as { steps: StepRegistry };
    const eslint = new ESLint({
      cwd: HOST_DIR,
      overrideConfigFile: resolve(HOST_DIR, 'eslint.config.mjs'),
    });
    const loader = createLoader({
      lookup: ['rafa.config.ts'],
      layers: [{ layer: 'defaults', dir: 'defaults' }, { layer: 'project', dir: '.' }],
      steps,
    });

    // Act
    const started = performance.now();
    const [result] = await eslint.lintFiles(['rafa.config.ts']);
    const elapsedMs = performance.now() - started;
    const loaded = await loader.load(HOST_DIR);
    const pluginCodes = uniqueSorted((result?.messages ?? [])
      .filter((m) => m.ruleId?.startsWith(PREFIX))
      .map((m) => (m.ruleId ?? '').slice(PREFIX.length)));
    const loaderCodes = uniqueSorted(loaded.diagnostics.map((d) => d.code));

    // Assert
    expect(pluginCodes.length).toBeGreaterThan(0);
    expect(pluginCodes).toEqual(loaderCodes);
    expect(elapsedMs).toBeLessThan(LINT_WALL_TIME_BOUND_MS);
    console.log(`fixture lint wall time: ${Math.round(elapsedMs)}ms`);
  });
});
