import type { DiagnosticCode } from '@open-tomato/define-config';

import * as tsParser from '@typescript-eslint/parser';
import { describe, expect, test } from 'bun:test';
import { RuleTester } from 'eslint';

import { SETTINGS_KEY } from '../analysis/settings';
import { DEFAULTS_PREFIX } from '../locate';

import { createCodeRule, FINDING_MESSAGE_ID } from './code-rule';
import { CODE_RULES, RULES } from './rules';

RuleTester.describe = describe;
RuleTester.it = test;
RuleTester.itOnly = test.only;

const ruleTester = new RuleTester({ languageOptions: { parser: tsParser } });

/** A registry: `lint` ends `ok` or `fail`, `fix` ends `ok`, `ask` ends `ok` and is interactive. */
const STEPS = {
  lint: { outcomes: ['ok', 'fail'] },
  fix: { outcomes: ['ok'] },
  ask: { outcomes: ['ok'], interactive: true },
};

/** A config file passing `array` to the imported `defineConfig(`; the array starts on line 3. */
const sourceOf = (array: string): string => 'import { defineConfig } from \'@open-tomato/define-config\';\n\n'
  + `export default defineConfig(${array});\n`;

/** eslint's shared settings holding `raw` as the plugin's. */
const settingsOf = (raw: unknown): Readonly<Record<string, unknown>> => ({ [SETTINGS_KEY]: raw });

/** Where one finding is reported, 1-based as ESLint counts. */
interface Report {
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/**
 * One rule's cases: an array with a literal value that the rule reports,
 * the same array with that value behind an identifier, the settings both
 * run under, and what the literal array reports.
 */
interface Case {
  readonly code: DiagnosticCode;
  readonly literal: string;
  readonly opaque: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly reports: readonly Report[];
}

const FLOW_SETTINGS = { steps: STEPS };

const CASES: readonly Case[] = [
  {
    code: 'duplicate-key',
    literal: '[\n  { a: 1 },\n  { a: 2 },\n]',
    opaque: '[\n  { a: 1 },\n  { a: value },\n]',
    settings: {},
    reports: [{
      message: 'a is set more than once within one layer: layer "project" (entries 0, 1)',
      line: 5,
      column: 5,
      endLine: 5,
      endColumn: 9,
    }],
  },
  {
    code: 'required-dropped',
    literal: '[\n  { a: 1 },\n  { a: false },\n]',
    opaque: '[\n  { a: 1 },\n  { a: dropIt },\n]',
    settings: { required: ['a'] },
    reports: [{
      message: 'a is required but was dropped: entry 1 removed a with false',
      line: 5,
      column: 5,
      endLine: 5,
      endColumn: 13,
    }],
  },
  {
    code: 'handler-conflict',
    literal: '[{\n  flows: { f: {\n    a: { step: \'lint\', on: { ok: \'b\' }, onFail: \'b\' },\n    b: { step: \'fix\' },\n  } },\n}]',
    opaque: '[{\n  flows: { f: {\n    a: { step: \'lint\', on: { ok: \'b\' }, onFail: target },\n    b: { step: \'fix\' },\n  } },\n}]',
    settings: FLOW_SETTINGS,
    reports: [{
      message: '`on` sits beside sugar `onFail`; this entry\'s handlers are dropped',
      line: 5,
      column: 5,
      endLine: 5,
      endColumn: 54,
    }],
  },
  {
    code: 'unknown-step',
    literal: '[{\n  flows: { f: {\n    a: { step: \'nope\' },\n  } },\n}]',
    opaque: '[{\n  flows: { f: {\n    a: { step: name },\n  } },\n}]',
    settings: FLOW_SETTINGS,
    reports: [{
      message: '`step` is "nope", which is not a registered step',
      line: 5,
      column: 10,
      endLine: 5,
      endColumn: 22,
    }],
  },
  {
    code: 'unknown-outcome',
    literal: '[{\n  flows: { f: {\n    a: { step: \'fix\', on: { fail: \'b\' } },\n    b: { step: \'fix\' },\n  } },\n}]',
    opaque: '[{\n  flows: { f: {\n    a: { step: \'fix\', on: { fail: target } },\n    b: { step: \'fix\' },\n  } },\n}]',
    settings: FLOW_SETTINGS,
    reports: [{
      message: 'step "fix" declares no outcome "fail"; it declares "ok"',
      line: 5,
      column: 29,
      endLine: 5,
      endColumn: 38,
    }],
  },
  {
    code: 'impure-when',
    literal: '[{\n  flows: { f: {\n    a: { step: \'lint\' },\n    b: { step: \'fix\', when: \'after:a\' },\n  } },\n}]',
    opaque: '[{\n  flows: { f: {\n    a: { step: \'lint\' },\n    b: { step: \'fix\', when: anchor },\n  } },\n}]',
    settings: FLOW_SETTINGS,
    reports: [{
      message: '`when` sits on step "fix", which is not registered as pure',
      line: 6,
      column: 23,
      endLine: 6,
      endColumn: 38,
    }],
  },
  {
    code: 'cycle',
    literal: '[{\n  flows: { f: {\n    a: { step: \'lint\', on: { ok: \'b\' } },\n    b: { step: \'fix\', on: { ok: \'a\' } },\n  } },\n}]',
    opaque: '[{\n  flows: { f: {\n    a: { step: \'lint\', on: { ok: \'b\' } },\n    b: { step: \'fix\', on: { ok: back } },\n  } },\n}]',
    settings: FLOW_SETTINGS,
    reports: [{
      message: 'the handler on "ok" closes a cycle with the edge b → a; the cycle is a → b → a. '
        + 'Mark the edge `{ to: "a", repeat: true }` if the loop is wanted',
      line: 6,
      column: 29,
      endLine: 6,
      endColumn: 36,
    }],
  },
  {
    code: 'interactive-unattended',
    literal: '[{\n  flows: { f: {\n    $unattended: true,\n    a: { step: \'ask\' },\n  } },\n}]',
    opaque: '[{\n  flows: { f: {\n    $unattended: flag,\n    a: { step: \'ask\' },\n  } },\n}]',
    settings: FLOW_SETTINGS,
    reports: [{
      message: 'step "ask" is interactive, but flow "f" is `$unattended` and reaches it at "a"',
      line: 6,
      column: 5,
      endLine: 6,
      endColumn: 23,
    }],
  },
  {
    code: 'unreachable',
    literal: '[{\n  flows: { f: {\n    a: { step: \'lint\', on: { ok: \'b\' } },\n    b: { step: \'fix\' },\n    c: { step: \'fix\' },\n  } },\n}]',
    opaque: '[{\n  flows: { f: {\n    a: { step: \'lint\', on: { ok: \'b\', fail: target } },\n    b: { step: \'fix\' },\n    c: { step: \'fix\' },\n  } },\n}]',
    settings: FLOW_SETTINGS,
    reports: [{
      message: 'step entry "c" is never reached from "a", the start of flow "f"',
      line: 7,
      column: 5,
      endLine: 7,
      endColumn: 23,
    }],
  },
];

/** The `duplicate-key` case, whose finding every other rule must leave alone. */
const [DUPLICATE_KEY_CASE] = CASES;

/** The `unknown-step` case, whose finding the `duplicate-key` rule must leave alone. */
const UNKNOWN_STEP_CASE = CASES.find((item) => item.code === 'unknown-step');

/** The rule made for `code`, or fail the test. */
const ruleFor = (code: DiagnosticCode) => {
  const rule = CODE_RULES[code];
  if (rule === undefined) {
    throw new Error(`no rule for ${code}`);
  }
  return rule;
};

/** `array` with a non-literal element appended, which makes the file `unsupported`. */
const withOpaqueElement = (array: string): string => `${array.slice(0, -1).replace(/,?\s*$/, '')}, extra]`;

describe('the RULES table', () => {
  test('reports the nine codes the analysis can find and not `schema` or `load-failed`', () => {
    // Arrange
    const reported = Object.entries(RULES)
      .filter(([, spec]) => spec !== 'not-reported')
      .map(([code]) => code);

    // Act
    const ruleNames = Object.keys(CODE_RULES);

    // Assert
    expect(reported).toEqual(CASES.map((item) => item.code));
    expect(ruleNames).toEqual(reported);
    expect(RULES.schema).toBe('not-reported');
    expect(RULES['load-failed']).toBe('not-reported');
  });

  test('makes each rule a `problem` with the row\'s description, no options and one message', () => {
    // Arrange
    const rows = Object.entries(RULES).flatMap(([code, spec]) => spec === 'not-reported'
      ? []
      : [{ code, spec }]);

    // Act
    const metas = rows.map(({ code }) => CODE_RULES[code]?.meta);

    // Assert
    expect(metas).toEqual(rows.map(({ spec }) => ({
      type: 'problem',
      docs: { description: spec.description },
      schema: [],
      messages: { [FINDING_MESSAGE_ID]: '{{ message }}' },
    })));
  });
});

describe('each code rule', () => {
  test('has one case per rule in the table', () => {
    expect(CASES.map((item) => item.code)).toEqual(Object.keys(CODE_RULES) as DiagnosticCode[]);
  });

  CASES.forEach((item) => {
    const foreign = item.code === 'duplicate-key'
      ? UNKNOWN_STEP_CASE
      : DUPLICATE_KEY_CASE;
    if (foreign === undefined) {
      throw new Error('the foreign case is missing');
    }
    ruleTester.run(`define-config/${item.code}`, ruleFor(item.code), {
      valid: [
        {
          name: 'silent when the value is behind an identifier',
          code: sourceOf(item.opaque),
          settings: settingsOf(item.settings),
        },
        {
          name: 'silent on an unsupported file',
          code: sourceOf(withOpaqueElement(item.literal)),
          settings: settingsOf(item.settings),
        },
        {
          name: 'silent without settings',
          code: sourceOf(item.literal),
        },
        {
          name: 'silent under malformed settings',
          code: sourceOf(item.literal),
          settings: settingsOf({ ...item.settings, duplicates: 'loud' }),
        },
        {
          name: 'silent without an imported defineConfig(',
          code: sourceOf(item.literal).replace('\'@open-tomato/define-config\'', '\'./elsewhere\''),
          settings: settingsOf(item.settings),
        },
        {
          name: 'silent on another code\'s finding',
          code: sourceOf(foreign.literal),
          settings: settingsOf({ ...foreign.settings, steps: STEPS }),
        },
      ],
      invalid: [
        {
          name: 'reports the literal value with the library\'s message',
          code: sourceOf(item.literal),
          settings: settingsOf(item.settings),
          errors: item.reports.map((report) => ({ ...report })),
        },
      ],
    });
  });
});

ruleTester.run('define-config/unknown-step from defaults', ruleFor('unknown-step'), {
  valid: [],
  invalid: [
    {
      name: 'reports a finding a defaults entry owns on the defineConfig callee, prefixed',
      code: sourceOf('[{ other: 1 }]'),
      settings: settingsOf({ ...FLOW_SETTINGS, defaults: [{ flows: { f: { a: { step: 'nope' } } } }] }),
      errors: [{
        message: `${DEFAULTS_PREFIX} \`step\` is "nope", which is not a registered step`,
        line: 3,
        column: 16,
        endLine: 3,
        endColumn: 28,
      }],
    },
  ],
});

describe('createCodeRule', () => {
  test('makes a rule for any code, reporting only that code', () => {
    // Arrange
    const rule = createCodeRule('cycle', { description: 'cycles' });

    // Act
    const meta = rule.meta;

    // Assert
    expect(meta?.docs?.description).toBe('cycles');
    expect(meta?.type).toBe('problem');
  });
});
