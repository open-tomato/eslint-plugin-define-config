/**
 * The `define-config/settings` rule: one report on the `defineConfig(`
 * call when the plugin's host data in `settings['define-config']` is
 * absent or malformed.
 *
 * The nine code rules stay silent when they cannot read the settings, so
 * a settings mistake (the data under the wrong key, a misspelt field)
 * would otherwise switch every one of them off without a word. This rule
 * is the word: it reports the mistake once per config file, on the
 * `defineConfig` callee, with every problem the settings reader found.
 *
 * A file with no `defineConfig(` call, or with more than one, reports
 * nothing, as it is not a config file the plugin reads. A file that is
 * `unsupported` still reports, since its call is known and the settings
 * mistake is the same whatever the file holds.
 *
 * @module
 */
import type { TSESTree } from '@typescript-eslint/types';
import type { Rule } from 'eslint';

import { readSettings, SETTINGS_KEY } from '../analysis/settings';
import { readEntries } from '../reader/read-entries';

/** The name the rule has under the plugin's prefix: `define-config/settings`. */
export const SETTINGS_RULE_NAME = 'settings';

/** The id of the message reported when `settings['define-config']` is not set. */
export const ABSENT_MESSAGE_ID = 'absent';

/**
 * The id of the message reported when `settings['define-config']` is set
 * but malformed. Its text names every problem, passed in as
 * `data.problems`.
 */
export const MALFORMED_MESSAGE_ID = 'malformed';

/** What the rule reports when the settings are absent. */
const ABSENT_MESSAGE = `settings['${SETTINGS_KEY}'] is not set, so no define-config rule can analyse this file; `
  + 'set it in the eslint config\'s `settings`';

/** What the rule reports when the settings are malformed, before the problems. */
const MALFORMED_MESSAGE = `settings['${SETTINGS_KEY}'] is malformed, so no define-config rule can analyse this file: {{ problems }}`;

/** Report the settings mistake, if any, on the `defineConfig(` call of the file `context` lints. */
const reportSettings = (context: Rule.RuleContext): void => {
  const settings = readSettings(context.settings);
  if (settings.kind === 'ok') {
    return;
  }
  // The files linted are parsed by `@typescript-eslint/parser`, whose AST
  // is the TSESTree the reader walks; ESLint types it as plain ESTree.
  const read = readEntries(context.sourceCode.ast as unknown as TSESTree.Program);
  if (read.kind === 'none') {
    return;
  }
  const { loc } = read.call.callee;
  if (settings.kind === 'absent') {
    context.report({ loc, messageId: ABSENT_MESSAGE_ID });
    return;
  }
  context.report({ loc, messageId: MALFORMED_MESSAGE_ID, data: { problems: settings.problems.join('; ') } });
};

/**
 * The rule reporting a missing or malformed `settings['define-config']`
 * once on the `defineConfig` callee of a config file.
 *
 * @example
 * ```ts
 * // settings: {}
 * // file: export default defineConfig([{ a: 1 }]);
 * // → one `absent` report on `defineConfig`
 *
 * // settings: { 'define-config': { duplicates: 'loud' } }
 * // → one `malformed` report naming `duplicates`
 * ```
 */
export const settingsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: `Report a config file linted while \`settings['${SETTINGS_KEY}']\` is absent or malformed.`,
    },
    schema: [],
    messages: {
      [ABSENT_MESSAGE_ID]: ABSENT_MESSAGE,
      [MALFORMED_MESSAGE_ID]: MALFORMED_MESSAGE,
    },
  },
  create: (context) => ({
    Program: () => reportSettings(context),
  }),
};
