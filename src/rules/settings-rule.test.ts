import * as tsParser from '@typescript-eslint/parser';
import { describe, expect, test } from 'bun:test';
import { RuleTester } from 'eslint';

import { SETTINGS_KEY } from '../analysis/settings';

import { ABSENT_MESSAGE_ID, MALFORMED_MESSAGE_ID, settingsRule } from './settings-rule';

RuleTester.describe = describe;
RuleTester.it = test;
RuleTester.itOnly = test.only;

const ruleTester = new RuleTester({ languageOptions: { parser: tsParser } });

/** A config file passing `array` to the imported `defineConfig(`, whose callee spans line 3, columns 16–28. */
const sourceOf = (array: string): string => 'import { defineConfig } from \'@open-tomato/define-config\';\n\n'
  + `export default defineConfig(${array});\n`;

/** eslint's shared settings holding `raw` as the plugin's. */
const settingsOf = (raw: unknown): Readonly<Record<string, unknown>> => ({ [SETTINGS_KEY]: raw });

/** Where the rule reports: the `defineConfig` callee. */
const AT_CALLEE = { line: 3, column: 16, endLine: 3, endColumn: 28 } as const;

/** A literal config holding a duplicate key, which the code rules would report. */
const DUPLICATE = '[{ a: 1 }, { a: 2 }]';

describe('the settings rule', () => {
  test('is a `problem` with no options and the two messages', () => {
    // Arrange
    const meta = settingsRule.meta;

    // Act
    const messageIds = Object.keys(meta?.messages ?? {});

    // Assert
    expect(meta?.type).toBe('problem');
    expect(meta?.schema).toEqual([]);
    expect(messageIds).toEqual([ABSENT_MESSAGE_ID, MALFORMED_MESSAGE_ID]);
  });
});

ruleTester.run('define-config/settings', settingsRule, {
  valid: [
    {
      name: 'silent under well-formed settings',
      code: sourceOf(DUPLICATE),
      settings: settingsOf({ steps: { lint: { outcomes: ['ok'] } } }),
    },
    {
      name: 'silent under empty settings, every field being optional',
      code: sourceOf(DUPLICATE),
      settings: settingsOf({}),
    },
    {
      name: 'silent without settings on a file with no defineConfig(',
      code: 'export default [{ a: 1 }];\n',
    },
    {
      name: 'silent without settings when defineConfig is not imported from the library',
      code: sourceOf(DUPLICATE).replace('\'@open-tomato/define-config\'', '\'./elsewhere\''),
    },
    {
      name: 'silent without settings on a file with two defineConfig( calls',
      code: `${sourceOf(DUPLICATE)}export const other = defineConfig([]);\n`,
    },
  ],
  invalid: [
    {
      name: 'reports once on the callee when the settings are absent',
      code: sourceOf(DUPLICATE),
      errors: [{
        message: `settings['${SETTINGS_KEY}'] is not set, so no define-config rule can analyse this file; `
          + 'set it in the eslint config\'s `settings`',
        ...AT_CALLEE,
      }],
    },
    {
      name: 'reports when the settings sit under the wrong key',
      code: sourceOf(DUPLICATE),
      settings: { defineConfig: { steps: {} } },
      errors: [{ messageId: ABSENT_MESSAGE_ID, ...AT_CALLEE }],
    },
    {
      name: 'reports on an unsupported file, whose call is still known',
      code: sourceOf('[{ a: 1 }, extra]'),
      errors: [{ messageId: ABSENT_MESSAGE_ID, ...AT_CALLEE }],
    },
    {
      name: 'reports a malformed field with the reader\'s problem',
      code: sourceOf(DUPLICATE),
      settings: settingsOf({ duplicates: 'loud' }),
      errors: [{
        message: `settings['${SETTINGS_KEY}'] is malformed, so no define-config rule can analyse this file: `
          + 'duplicates: expected \'warn\', \'error\' or \'allow\', got "loud"',
        ...AT_CALLEE,
      }],
    },
    {
      name: 'reports every problem in one report',
      code: sourceOf(DUPLICATE),
      settings: settingsOf({ required: 'a', step: {} }),
      errors: [{
        message: `settings['${SETTINGS_KEY}'] is malformed, so no define-config rule can analyse this file: `
          + 'required: expected an array of dot-joined paths, got string; '
          + 'step: unknown key; expected one of defaults, steps, required, duplicates',
        ...AT_CALLEE,
      }],
    },
    {
      name: 'reports settings that are not an object',
      code: sourceOf(DUPLICATE),
      settings: settingsOf([]),
      errors: [{
        message: `settings['${SETTINGS_KEY}'] is malformed, so no define-config rule can analyse this file: `
          + `${SETTINGS_KEY}: expected an object, got array`,
        ...AT_CALLEE,
      }],
    },
  ],
});
