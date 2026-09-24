import type { ESLint } from 'eslint';

import { describe, expect, test } from 'bun:test';

import { RULES } from '../rules/rules';
import { SETTINGS_RULE_NAME } from '../rules/settings-rule';

import { createRecommended, PLUGIN_PREFIX, RECOMMENDED_LEVELS, RECOMMENDED_RULES } from './recommended';

/** The rule names the `RULES` table reports, in table order. */
const reportedCodes = Object.entries(RULES)
  .flatMap(([code, spec]) => spec === 'not-reported'
    ? []
    : [code]);

describe('RECOMMENDED_LEVELS', () => {
  test('puts `duplicate-key` and `unreachable` at `warn`, as the library emits them', () => {
    // Arrange
    const levels = Object.entries(RECOMMENDED_LEVELS);

    // Act
    const warned = levels.filter(([, level]) => level === 'warn').map(([name]) => name);

    // Assert
    expect(warned.sort()).toEqual(['duplicate-key', 'unreachable']);
  });

  test('puts every other code rule and `settings` at `error`', () => {
    // Arrange
    const levels = Object.entries(RECOMMENDED_LEVELS);

    // Act
    const errored = levels.filter(([, level]) => level === 'error').map(([name]) => name);

    // Assert
    expect(errored.sort()).toEqual([
      'cycle',
      'handler-conflict',
      'impure-when',
      'interactive-unattended',
      'required-dropped',
      SETTINGS_RULE_NAME,
      'unknown-outcome',
      'unknown-step',
    ]);
  });

  test('has a level for exactly each reported code of `RULES` and `settings`', () => {
    // Arrange
    const expected = [...reportedCodes, SETTINGS_RULE_NAME];

    // Act
    const names = Object.keys(RECOMMENDED_LEVELS);

    // Assert
    expect(names.sort()).toEqual(expected.sort());
    expect(names).not.toContain('schema');
    expect(names).not.toContain('load-failed');
  });
});

describe('RECOMMENDED_RULES', () => {
  test('names each rule under the `define-config/` prefix with its level', () => {
    // Arrange
    const expected = Object.entries(RECOMMENDED_LEVELS).map(([name, level]): [string, string] => [`define-config/${name}`, level]);

    // Act
    const rules: [string, string][] = Object.entries(RECOMMENDED_RULES);

    // Assert
    expect(rules).toEqual(expected);
  });
});

describe('createRecommended', () => {
  test('registers the plugin it is given under the prefix and sets the preset rules', () => {
    // Arrange
    const plugin: ESLint.Plugin = { rules: {} };

    // Act
    const config = createRecommended(plugin);

    // Assert
    expect(config.name).toBe('define-config/recommended');
    expect(config.plugins?.[PLUGIN_PREFIX]).toBe(plugin);
    expect(config.rules).toEqual(RECOMMENDED_RULES);
    expect(config.settings).toBeUndefined();
  });

  test('gives each preset its own rules object', () => {
    // Arrange
    const plugin: ESLint.Plugin = { rules: {} };

    // Act
    const config = createRecommended(plugin);

    // Assert
    expect(config.rules).not.toBe(RECOMMENDED_RULES);
  });
});
