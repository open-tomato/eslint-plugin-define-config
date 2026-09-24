import type { Linter } from 'eslint';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const HOST_DIR = resolve(import.meta.dir, '../fixtures/host');

/** The 1-based line of the first line of `file` containing `needle`, after `after` lines. */
const lineOf = (file: string, needle: string, after = 0): number => {
  const lines = readFileSync(resolve(HOST_DIR, file), 'utf8').split('\n');
  const index = lines.findIndex((text, i) => i >= after && text.includes(needle));

  return index + 1;
};

/** Lints one fixture file with the host's own eslint config, plus `extra` rules. */
const lintFixture = async (
  file: string,
  extra: Linter.RulesRecord = {},
): Promise<Linter.LintMessage[]> => {
  const eslint = new ESLint({
    cwd: HOST_DIR,
    overrideConfigFile: resolve(HOST_DIR, 'eslint.config.mjs'),
    overrideConfig: { rules: extra },
  });
  const [result] = await eslint.lintFiles([file]);

  return result?.messages ?? [];
};

/** The messages of `messages` for one unprefixed rule name. */
const forRule = (messages: Linter.LintMessage[], rule: string): Linter.LintMessage[] => messages.filter((message) => message.ruleId === `define-config/${rule}`);

describe('the host fixture', () => {
  test('reports duplicate-key on the repeated key and unknown-outcome on the handler', async () => {
    // Arrange
    const file = 'rafa.config.ts';
    const firstTimeout = lineOf(file, 'timeout: 60');
    const repeatedTimeout = lineOf(file, 'timeout: 90');
    const handler = lineOf(file, 'fail: \'rollback\'');

    // Act
    const messages = await lintFixture(file);

    // Assert
    expect(forRule(messages, 'duplicate-key').map((m) => m.line)).toEqual([repeatedTimeout]);
    expect(forRule(messages, 'duplicate-key')[0]?.line).not.toBe(firstTimeout);
    expect(forRule(messages, 'unknown-outcome').map((m) => m.line)).toEqual([handler]);
  });

  test('yields no unknown-outcome or unreachable for the opaque variant', async () => {
    // Arrange
    const file = 'opaque/rafa.config.ts';

    // Act
    const messages = await lintFixture(file);

    // Assert
    expect(forRule(messages, 'unknown-outcome')).toEqual([]);
    expect(forRule(messages, 'unreachable')).toEqual([]);
    expect(forRule(messages, 'duplicate-key')).toHaveLength(1);
  });

  test('removes the duplicate-key report when the rule is off', async () => {
    // Arrange
    const file = 'rafa.config.ts';

    // Act
    const messages = await lintFixture(file, { 'define-config/duplicate-key': 'off' });

    // Assert
    expect(forRule(messages, 'duplicate-key')).toEqual([]);
    expect(forRule(messages, 'unknown-outcome')).toHaveLength(1);
  });
});
