/**
 * `@open-tomato/eslint-plugin-define-config`: ESLint rules that report
 * `@open-tomato/define-config` merge and step-graph diagnostics on the
 * config entry that causes them.
 *
 * The default export is the plugin object: its `rules` (the nine code
 * rules and `settings`), `configs.recommended`, and `meta`. It is the
 * only value the module exports, so a host reading `plugin.configs` does
 * not trip `import/no-named-as-default-member`.
 *
 * @packageDocumentation
 */
import type { ESLint, Linter, Rule } from 'eslint';

import { createRecommended } from './configs/recommended';
import { CODE_RULES } from './rules/rules';
import { SETTINGS_RULE_NAME, settingsRule } from './rules/settings-rule';

/**
 * The plugin's identity, as ESLint reads it from a plugin's `meta`.
 */
const meta = {
  name: '@open-tomato/eslint-plugin-define-config',
} as const;

/**
 * Every rule the plugin ships, by unprefixed name: one per reported
 * diagnostic code, and `settings`.
 */
const rules: Readonly<Record<string, Rule.RuleModule>> = {
  ...CODE_RULES,
  [SETTINGS_RULE_NAME]: settingsRule,
};

/** The plugin object's shape: an ESLint plugin whose `configs` holds `recommended`. */
export interface DefineConfigPlugin extends ESLint.Plugin {
  /** The plugin's identity. */
  readonly meta: typeof meta;
  /** Every rule the plugin ships, by unprefixed name. */
  readonly rules: Readonly<Record<string, Rule.RuleModule>>;
  /** The plugin's presets. */
  readonly configs: {
    /** Every rule at the library's default level for its code; see `src/configs/recommended.ts`. */
    readonly recommended: Linter.Config;
  };
}

/** The plugin, before its `configs` exist; the preset registers this object. */
const base = { meta, rules };

/**
 * The plugin object: `rules`, `configs.recommended` and `meta`. The
 * preset registers the plugin under the `define-config` prefix, so it
 * works on its own in a flat config. `configs` is added to `base` in
 * place, not to a copy, so the plugin the preset registers is this very
 * object: ESLint refuses a flat config that registers two different
 * objects under one plugin prefix.
 */
const plugin: DefineConfigPlugin = Object.assign(base, {
  configs: { recommended: createRecommended(base) },
});

export default plugin;
