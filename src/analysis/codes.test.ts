import type { Analysis } from './analyse';
import type { DiagnosticCode } from '@open-tomato/define-config';

import { parse } from '@typescript-eslint/parser';
import { describe, expect, test } from 'bun:test';

import { readEntries } from '../reader/read-entries';

import { analyse } from './analyse';
import { readSettings, SETTINGS_KEY } from './settings';
import { suppress } from './suppress';

const IMPORT = 'import { defineConfig } from \'@open-tomato/define-config\';\n';

/** A registry: `lint` ends `ok` or `fail`, `fix` ends `ok`, `ask` ends `ok` and is interactive. */
const STEPS = {
  lint: { outcomes: ['ok', 'fail'] },
  fix: { outcomes: ['ok'] },
  ask: { outcomes: ['ok'], interactive: true },
};

/** Analyse `defineConfig(<array>)` under the settings `raw`, or fail the test. */
const analyseArray = (array: string, raw: Readonly<Record<string, unknown>>): Analysis => {
  const program = parse(`${IMPORT}export default defineConfig(${array});`, { sourceType: 'module', range: true, loc: true });
  const read = readEntries(program);
  if (read.kind !== 'entries') {
    throw new Error(`expected entries, got ${read.kind}`);
  }
  const settings = readSettings({ [SETTINGS_KEY]: raw });
  if (settings.kind !== 'ok') {
    throw new Error(`expected ok settings, got ${JSON.stringify(settings)}`);
  }
  return analyse(read, settings.settings);
};

/** Every code the analysis found before suppression, merge then graph. */
const rawCodes = (analysis: Analysis): readonly DiagnosticCode[] => [
  ...analysis.merge.diagnostics,
  ...(analysis.graph?.diagnostics ?? []),
].map((diagnostic) => diagnostic.code);

/** Every code that survives the suppression, merge then graph. */
const keptCodes = (analysis: Analysis): readonly DiagnosticCode[] => {
  const findings = suppress(analysis);
  return [...findings.merge, ...findings.graph].map((diagnostic) => diagnostic.code);
};

/** One code: a config with a literal value, the same with an identifier there, and the settings. */
interface Case {
  readonly code: DiagnosticCode;
  readonly literal: string;
  readonly opaque: string;
  readonly settings: Readonly<Record<string, unknown>>;
}

const FLOW_SETTINGS = { steps: STEPS };

const CASES: readonly Case[] = [
  {
    code: 'duplicate-key',
    literal: '[{ a: 1 }, { a: 2 }]',
    opaque: '[{ a: 1 }, { a: value }]',
    settings: {},
  },
  {
    code: 'required-dropped',
    literal: '[{ a: 1 }, { a: false }]',
    opaque: '[{ a: 1 }, { a: dropIt }]',
    settings: { required: ['a'] },
  },
  {
    code: 'handler-conflict',
    literal: '[{ flows: { f: { a: { step: \'lint\', on: { ok: \'b\' }, onFail: \'b\' }, b: { step: \'fix\' } } } }]',
    opaque: '[{ flows: { f: { a: { step: \'lint\', on: { ok: \'b\' }, onFail: target }, b: { step: \'fix\' } } } }]',
    settings: FLOW_SETTINGS,
  },
  {
    code: 'unknown-step',
    literal: '[{ flows: { f: { a: { step: \'nope\' } } } }]',
    opaque: '[{ flows: { f: { a: { step: name } } } }]',
    settings: FLOW_SETTINGS,
  },
  {
    code: 'unknown-outcome',
    literal: '[{ flows: { f: { a: { step: \'fix\', on: { fail: \'b\' } }, b: { step: \'fix\' } } } }]',
    opaque: '[{ flows: { f: { a: { step: \'fix\', on: { fail: target } }, b: { step: \'fix\' } } } }]',
    settings: FLOW_SETTINGS,
  },
  {
    code: 'impure-when',
    literal: '[{ flows: { f: { a: { step: \'lint\' }, b: { step: \'fix\', when: \'after:a\' } } } }]',
    opaque: '[{ flows: { f: { a: { step: \'lint\' }, b: { step: \'fix\', when: anchor } } } }]',
    settings: FLOW_SETTINGS,
  },
  {
    code: 'cycle',
    literal: '[{ flows: { f: { a: { step: \'lint\', on: { ok: \'b\' } }, b: { step: \'fix\', on: { ok: \'a\' } } } } }]',
    opaque: '[{ flows: { f: { a: { step: \'lint\', on: { ok: \'b\' } }, b: { step: \'fix\', on: { ok: back } } } } }]',
    settings: FLOW_SETTINGS,
  },
  {
    code: 'interactive-unattended',
    literal: '[{ flows: { f: { $unattended: true, a: { step: \'ask\' } } } }]',
    opaque: '[{ flows: { f: { $unattended: flag, a: { step: \'ask\' } } } }]',
    settings: FLOW_SETTINGS,
  },
  {
    code: 'unreachable',
    literal: '[{ flows: { f: { a: { step: \'lint\', on: { ok: \'b\' } }, b: { step: \'fix\' }, c: { step: \'fix\' } } } }]',
    opaque: '[{ flows: { f: { a: { step: \'lint\', on: { ok: \'b\', fail: target } }, b: { step: \'fix\' }, c: { step: \'fix\' } } } }]',
    settings: FLOW_SETTINGS,
  },
];

describe('each analysis code', () => {
  test('covers the nine codes the analysis can find', () => {
    expect([...CASES.map((item) => item.code)].sort()).toEqual([
      'cycle',
      'duplicate-key',
      'handler-conflict',
      'impure-when',
      'interactive-unattended',
      'required-dropped',
      'unknown-outcome',
      'unknown-step',
      'unreachable',
    ]);
  });

  for (const item of CASES) {
    describe(item.code, () => {
      test('appears with a literal value', () => {
        // Arrange
        const analysis = analyseArray(item.literal, item.settings);

        // Act
        const codes = keptCodes(analysis);

        // Assert
        expect(codes).toContain(item.code);
      });

      test('disappears with the same value behind an identifier', () => {
        // Arrange
        const analysis = analyseArray(item.opaque, item.settings);

        // Act
        const codes = keptCodes(analysis);

        // Assert
        expect(codes).not.toContain(item.code);
      });
    });
  }

  test('an opaque `on` would make steps unreachable, and the suppression drops the finding', () => {
    // Arrange
    const analysis = analyseArray(
      '[{ flows: { f: { a: { step: \'lint\', on: handlers }, b: { step: \'fix\' } } } }]',
      FLOW_SETTINGS,
    );

    // Act
    const raw = rawCodes(analysis);
    const kept = keptCodes(analysis);

    // Assert
    expect(raw).toContain('unreachable');
    expect(kept).toEqual([]);
  });
});
