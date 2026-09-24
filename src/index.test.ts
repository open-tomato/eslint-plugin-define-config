import type { Linter } from 'eslint';

import * as tsParser from '@typescript-eslint/parser';
import { describe, expect, test } from 'bun:test';
import { Linter as EslintLinter } from 'eslint';

import packageJson from '../package.json';

import { SETTINGS_KEY } from './analysis/settings';
import { RECOMMENDED_LEVELS } from './configs/recommended';

import plugin from './index';

/** A config file whose array sets `a` twice in one layer: one `duplicate-key` finding. */
const DUPLICATE_SOURCE = 'import { defineConfig } from \'@open-tomato/define-config\';\n\n'
  + 'export default defineConfig([{ a: 1 }, { a: 2 }]);\n';

/** Lint `DUPLICATE_SOURCE` as `rafa.config.ts` under `config`, parsed by typescript-eslint. */
const lintDuplicate = (config: readonly Linter.Config[]): Linter.LintMessage[] => new EslintLinter({ configType: 'flat' })
  .verify(DUPLICATE_SOURCE, [
    { files: ['**/*.ts'], languageOptions: { parser: tsParser } },
    ...config,
  ], 'rafa.config.ts');

describe('the plugin object', () => {
  test('names itself after the package', () => {
    // Arrange
    const { name } = packageJson;

    // Act
    const pluginName: string = plugin.meta.name;

    // Assert
    expect(pluginName).toBe(name);
  });

  test('ships the nine code rules and `settings`, and nothing else', () => {
    // Arrange
    const expected = Object.keys(RECOMMENDED_LEVELS).sort();

    // Act
    const names = Object.keys(plugin.rules).sort();

    // Assert
    expect(names).toHaveLength(10);
    expect(names).toEqual(expected);
  });

  test('registers itself, not a copy, in `configs.recommended`', () => {
    // Arrange
    const { recommended } = plugin.configs;

    // Act
    const registered = recommended.plugins?.['define-config'];

    // Assert
    expect(registered).toBe(plugin);
  });
});

describe('configs.recommended under eslint', () => {
  test('reports `duplicate-key` at warn (severity 1)', () => {
    // Arrange
    const config = [plugin.configs.recommended, { settings: { [SETTINGS_KEY]: {} } }];

    // Act
    const messages = lintDuplicate(config);

    // Assert
    expect(messages.map(({ ruleId, severity }) => ({ ruleId, severity }))).toEqual([
      { ruleId: 'define-config/duplicate-key', severity: 1 },
    ]);
  });

  test('reports absent settings at error (severity 2)', () => {
    // Arrange
    const config = [plugin.configs.recommended];

    // Act
    const messages = lintDuplicate(config);

    // Assert
    expect(messages.map(({ ruleId, severity }) => ({ ruleId, severity }))).toEqual([
      { ruleId: 'define-config/settings', severity: 2 },
    ]);
  });

  test('lets a host turn a rule off and register the plugin again under the same prefix', () => {
    // Arrange
    const config = [
      plugin.configs.recommended,
      {
        plugins: { 'define-config': plugin },
        rules: { 'define-config/duplicate-key': 'off' },
        settings: { [SETTINGS_KEY]: {} },
      } satisfies Linter.Config,
    ];

    // Act
    const messages = lintDuplicate(config);

    // Assert
    expect(messages).toEqual([]);
  });
});
