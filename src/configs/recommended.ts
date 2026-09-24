/**
 * The `recommended` preset: every rule the plugin ships, at the level the
 * library gives its code by default.
 *
 * The library emits `duplicate-key` and `unreachable` at `warn` and every
 * other code it can produce here at `error`, so the preset does the same.
 * The `define-config/settings` rule is at `error`: with the settings
 * missing or malformed, every code rule is silent, so the mistake is not
 * one to let pass.
 *
 * @module
 */
import type { DiagnosticCode } from '@open-tomato/define-config';
import type { ESLint, Linter } from 'eslint';

import { SETTINGS_RULE_NAME } from '../rules/settings-rule';

/** The prefix the plugin's rules have in a host's eslint config: `define-config/<rule>`. */
export const PLUGIN_PREFIX = 'define-config';

/**
 * A code the plugin reports: every library code but the two its `RULES`
 * table marks `'not-reported'`.
 */
export type ReportedCode = Exclude<DiagnosticCode, 'schema' | 'load-failed'>;

/** The level a rule has in the preset. */
export type RecommendedLevel = 'warn' | 'error';

/**
 * The preset's level for each rule, by unprefixed rule name. Typed over
 * {@link ReportedCode}, so a library code added without a level here
 * fails `check-types`.
 */
export const RECOMMENDED_LEVELS: Readonly<Record<ReportedCode | typeof SETTINGS_RULE_NAME, RecommendedLevel>> = {
  'duplicate-key': 'warn',
  'required-dropped': 'error',
  'handler-conflict': 'error',
  'unknown-step': 'error',
  'unknown-outcome': 'error',
  'impure-when': 'error',
  'cycle': 'error',
  'interactive-unattended': 'error',
  'unreachable': 'warn',
  [SETTINGS_RULE_NAME]: 'error',
};

/**
 * The preset's rules as a host's eslint config writes them: each name
 * under the `define-config/` prefix, with its level from
 * {@link RECOMMENDED_LEVELS}.
 */
export const RECOMMENDED_RULES: Readonly<Record<string, RecommendedLevel>> = Object.fromEntries(Object
  .entries(RECOMMENDED_LEVELS)
  .map(([name, level]) => [`${PLUGIN_PREFIX}/${name}`, level]));

/**
 * The `recommended` flat config for `plugin`: the plugin registered under
 * the `define-config` prefix, and {@link RECOMMENDED_RULES}.
 *
 * It sets no `settings`; the host sets `settings['define-config']`
 * beside it.
 *
 * @example
 * ```ts
 * import defineConfigPlugin from '@open-tomato/eslint-plugin-define-config';
 *
 * export default [
 *   defineConfigPlugin.configs.recommended,
 *   { settings: { 'define-config': { steps } } },
 * ];
 * ```
 */
export const createRecommended = (plugin: ESLint.Plugin): Linter.Config => ({
  name: `${PLUGIN_PREFIX}/recommended`,
  plugins: { [PLUGIN_PREFIX]: plugin },
  rules: { ...RECOMMENDED_RULES },
});
