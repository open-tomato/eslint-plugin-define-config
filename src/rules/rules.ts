/**
 * The `RULES` table: one row per diagnostic code the library emits, and
 * the code rules built from it.
 *
 * The table is typed `Record<DiagnosticCode, RuleSpec | 'not-reported'>`,
 * so a code the library adds without a row here fails `check-types`.
 * A code the static analysis can never produce is `'not-reported'`:
 * `schema` needs the host's runtime validator and `load-failed` a real
 * file load, neither of which the plugin runs.
 *
 * @module
 */
import type { RuleSpec } from './code-rule';
import type { DiagnosticCode } from '@open-tomato/define-config';
import type { Rule } from 'eslint';

import { createCodeRule } from './code-rule';

/**
 * Every library diagnostic code, with the spec of the rule that reports
 * it or `'not-reported'` when no rule does. Each reported code's rule is
 * named after it: `define-config/<code>`.
 */
export const RULES: Readonly<Record<DiagnosticCode, RuleSpec | 'not-reported'>> = {
  'duplicate-key': {
    description: 'Report a key path set by two entries of the same layer.',
  },
  'required-dropped': {
    description: 'Report a required key path that an entry drops or that no entry sets.',
  },
  'handler-conflict': {
    description: 'Report a step entry whose `on` sits beside handler sugar, or whose handlers name one outcome twice.',
  },
  'unknown-step': {
    description: 'Report a step, handler target or `$start` that names no registered step or step entry.',
  },
  'unknown-outcome': {
    description: 'Report a handler for an outcome its step does not declare.',
  },
  'impure-when': {
    description: 'Report a `when` anchored on a step that is not registered as pure.',
  },
  'cycle': {
    description: 'Report a handler that closes a cycle in a flow without `repeat: true`.',
  },
  'interactive-unattended': {
    description: 'Report an interactive step in a flow marked `$unattended`.',
  },
  'unreachable': {
    description: 'Report a flow step no path from the flow\'s start reaches.',
  },
  'schema': 'not-reported',
  'load-failed': 'not-reported',
};

/**
 * The code rules, keyed by diagnostic code: one rule made by
 * `createCodeRule` for every row of {@link RULES} that is not
 * `'not-reported'`, in table order.
 */
export const CODE_RULES: Readonly<Record<string, Rule.RuleModule>> = Object.fromEntries(Object.entries(RULES)
  .flatMap(([code, spec]) => spec === 'not-reported'
    ? []
    : [[code, createCodeRule(code as DiagnosticCode, spec)]]));
