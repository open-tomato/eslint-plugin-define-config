/**
 * The host fixture's eslint config, written as a host writes it: the
 * plugin's `recommended` preset, with the host's defaults and step
 * registry under `settings['define-config']`.
 *
 * The plugin is imported from `../../src/index.ts` and the defaults and
 * steps from `.ts` files, so this config runs under the bun runtime
 * (`bun --bun eslint .`, the root `lint:fixture` script) and needs no
 * build first. The root `eslint .` ignores `fixtures/`, since this
 * fixture's `rafa.config.ts` is broken on purpose.
 */
import * as tsParser from '@typescript-eslint/parser';

import plugin from '../../src/index.ts';

import defaults from './defaults/rafa.config.ts';
import { steps } from './steps.ts';

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser },
  },
  plugin.configs.recommended,
  {
    settings: {
      'define-config': { defaults, steps },
    },
  },
];
