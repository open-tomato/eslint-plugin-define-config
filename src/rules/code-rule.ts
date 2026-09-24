/**
 * The rule factory: one ESLint rule per diagnostic code the library
 * reports, each reporting that code's findings on the node that caused
 * them.
 *
 * Every rule a factory makes runs the same pipeline over the linted file:
 * read `settings['define-config']`, read the `defineConfig(` array, take
 * the file's analysis from the `SourceCode`-keyed cache (so all the rules
 * share one merge and one graph resolution per file), drop the findings
 * an opaque value could influence, and report each surviving finding of
 * its own code where the locator places it, with the library's message.
 *
 * A rule reports nothing when the settings are absent or malformed (the
 * `define-config/settings` rule speaks for those), when the file has no
 * `defineConfig(` call or more than one, and when the file is
 * `unsupported` because an element of its array is not an object
 * literal.
 *
 * @module
 */
import type { FindingSource } from '../locate';
import type { Diagnostic, DiagnosticCode } from '@open-tomato/define-config';
import type { TSESTree } from '@typescript-eslint/types';
import type { Rule } from 'eslint';

import { analyse } from '../analysis/analyse';
import { cachedAnalysis } from '../analysis/cache';
import { readSettings } from '../analysis/settings';
import { suppress } from '../analysis/suppress';
import { locate } from '../locate';
import { readEntries } from '../reader/read-entries';

/**
 * What the `RULES` table says about one reported code: the text ESLint
 * shows as the rule's description.
 */
export interface RuleSpec {
  /** One line naming the problem the rule reports, for `meta.docs.description`. */
  readonly description: string;
}

/**
 * The id of the one message every code rule reports. Its text is the
 * finding's own message, passed in as `data.message`.
 */
export const FINDING_MESSAGE_ID = 'finding';

/** A surviving finding with the stage that produced it, which the locator needs. */
interface SourcedFinding {
  readonly diagnostic: Diagnostic;
  readonly source: FindingSource;
}

/** Tag each of `diagnostics` with `source`. */
const sourced = (diagnostics: readonly Diagnostic[], source: FindingSource): readonly SourcedFinding[] => diagnostics
  .map((diagnostic) => ({ diagnostic, source }));

/**
 * Report every surviving finding of `code` in the file `context` lints,
 * by the rules in this module's description.
 */
const reportCode = (context: Rule.RuleContext, code: DiagnosticCode): void => {
  const settings = readSettings(context.settings);
  if (settings.kind !== 'ok') {
    return;
  }
  // The files linted are parsed by `@typescript-eslint/parser`, whose AST
  // is the TSESTree the reader walks; ESLint types it as plain ESTree.
  const read = readEntries(context.sourceCode.ast as unknown as TSESTree.Program);
  if (read.kind !== 'entries') {
    return;
  }
  const analysis = cachedAnalysis(context.sourceCode, () => analyse(read, settings.settings));
  const findings = suppress(analysis);
  [...sourced(findings.merge, 'merge'), ...sourced(findings.graph, 'graph')]
    .filter(({ diagnostic }) => diagnostic.code === code)
    .forEach(({ diagnostic, source }) => {
      const located = locate(diagnostic, source, read, analysis);
      context.report({
        loc: located.node.loc,
        messageId: FINDING_MESSAGE_ID,
        data: { message: located.message },
      });
    });
};

/**
 * Make the rule that reports the library's diagnostic `code`. Its findings
 * come from the merge or from the graph, whichever produced them, and
 * each is reported with the library's message, prefixed
 * `(from defaults)` when a `defaults` entry owns it.
 *
 * @example
 * ```ts
 * const rule = createCodeRule('duplicate-key', { description: 'A key path set twice within one layer.' });
 * // settings: { 'define-config': {} }
 * // file: defineConfig([{ a: 1 }, { a: 2 }])
 * // → one report on the `a: 2` property
 * ```
 *
 * @param code - The diagnostic code the rule reports.
 * @param spec - The code's row in the `RULES` table.
 * @returns An ESLint rule of type `problem` with no options.
 */
export const createCodeRule = (code: DiagnosticCode, spec: RuleSpec): Rule.RuleModule => ({
  meta: {
    type: 'problem',
    docs: { description: spec.description },
    schema: [],
    messages: { [FINDING_MESSAGE_ID]: '{{ message }}' },
  },
  create: (context) => ({
    Program: () => reportCode(context, code),
  }),
});
