import * as library from '@open-tomato/define-config';
import * as tsParser from '@typescript-eslint/parser';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { ESLint } from 'eslint';

import plugin from './index';

const FILE_PATH = 'define-config.config.ts';

/** A config file whose two entries both set `a` in the one project layer. */
const DUPLICATE = 'import { defineConfig } from \'@open-tomato/define-config\';\n\n'
  + 'export default defineConfig([\n  { a: 1 },\n  { a: 2 },\n]);\n';

/** The same file with the second entry's `a` removed. */
const FIXED = 'import { defineConfig } from \'@open-tomato/define-config\';\n\n'
  + 'export default defineConfig([\n  { a: 1 },\n  { b: 2 },\n]);\n';

/** An `ESLint` running the recommended preset with the plugin's settings present. */
const createEslint = (): ESLint => new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.ts'], languageOptions: { parser: tsParser } },
    plugin.configs.recommended,
    { settings: { 'define-config': { steps: { lint: { outcomes: ['ok'] } } } } },
  ],
});

describe('an ESLint instance linting a config across an edit', () => {
  const mergeSpy = spyOn(library, 'merge');

  afterEach(() => {
    mergeSpy.mockClear();
  });

  test('reports the finding, then lints clean after the edit with the same instance', async () => {
    // Arrange
    const eslint = createEslint();

    // Act
    const [first] = await eslint.lintText(DUPLICATE, { filePath: FILE_PATH });
    const [second] = await eslint.lintText(FIXED, { filePath: FILE_PATH });

    // Assert
    expect(first?.messages.map((message) => message.ruleId)).toEqual(['define-config/duplicate-key']);
    expect(second?.messages).toEqual([]);
  });

  test('merges once per linted file, however many rules read the analysis', async () => {
    // Arrange
    const eslint = createEslint();

    // Act
    await eslint.lintText(DUPLICATE, { filePath: FILE_PATH });
    const afterFirst = mergeSpy.mock.calls.length;
    await eslint.lintText(FIXED, { filePath: FILE_PATH });

    // Assert
    expect(Object.keys(plugin.rules).length).toBeGreaterThan(1);
    expect(afterFirst).toBe(1);
    expect(mergeSpy.mock.calls.length).toBe(2);
  });
});
