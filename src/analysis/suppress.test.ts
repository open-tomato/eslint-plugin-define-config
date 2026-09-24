import type { Analysis } from './analyse';
import type { KeyPath } from '../reader/read-entries';
import type { Diagnostic } from '@open-tomato/define-config';

import { parse } from '@typescript-eslint/parser';
import { describe, expect, test } from 'bun:test';

import { readEntries } from '../reader/read-entries';

import { analyse } from './analyse';
import { readSettings, SETTINGS_KEY } from './settings';
import { isPrefix, keptGraphFindings, keptMergeFindings, opaqueReaches, overlaps, reachOf, suppress } from './suppress';

const IMPORT = 'import { defineConfig } from \'@open-tomato/define-config\';\n';

/** A registry with a step that ends `ok` or `fail`, and one that ends `ok`. */
const STEPS = { lint: { outcomes: ['ok', 'fail'] }, fix: { outcomes: ['ok'] } };

/** Flow `g`: `d` is never reached from `c`, so it is `unreachable` whatever the file does to `f`. */
const FLOW_G = { c: { step: 'lint' }, d: { step: 'fix' } };

/** Analyse `defineConfig(<array>)` under the settings `raw`, or fail the test. */
const analyseArray = (array: string, raw: Readonly<Record<string, unknown>> = {}): Analysis => {
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

/** Each diagnostic as `<code>@<dot-joined path>`, in order. */
const labels = (diagnostics: readonly Diagnostic[]): readonly string[] => diagnostics.map((diagnostic) => `${diagnostic.code}@${diagnostic.path.join('.')}`);

/** The graph diagnostics of `analysis`, or fail the test when none were resolved. */
const graphOf = (analysis: Analysis): readonly Diagnostic[] => {
  if (analysis.graph === undefined) {
    throw new Error('expected a resolved graph');
  }
  return analysis.graph.diagnostics;
};

/** A diagnostic at `path`, for the rules checked on their own. */
const at = (path: KeyPath, code: Diagnostic['code'] = 'duplicate-key'): Diagnostic => ({
  level: 'warn',
  code,
  path,
  message: `${code} at ${path.join('.')}`,
});

describe('isPrefix and overlaps', () => {
  test('the empty path and a path itself are prefixes of that path', () => {
    expect(isPrefix([], ['a', 'b'])).toBe(true);
    expect(isPrefix(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(isPrefix(['a'], ['a', 'b'])).toBe(true);
  });

  test('compares whole keys, so a shared string prefix or a dotted key is not a path prefix', () => {
    expect(isPrefix(['a'], ['ab'])).toBe(false);
    expect(isPrefix(['a'], ['a.b'])).toBe(false);
    expect(isPrefix(['a', 'b'], ['a'])).toBe(false);
    expect(isPrefix(['a', 'c'], ['a', 'b', 'c'])).toBe(false);
  });

  test('overlaps holds in both directions and fails for siblings', () => {
    expect(overlaps(['a'], ['a', 'b'])).toBe(true);
    expect(overlaps(['a', 'b'], ['a'])).toBe(true);
    expect(overlaps(['a', 'b'], ['a', 'c'])).toBe(false);
  });
});

describe('reachOf and opaqueReaches', () => {
  test('an opaque $replace reaches the object holding it; any other location reaches itself', () => {
    expect(reachOf(['flows', 'f', 'a', 'on', 'fail'])).toEqual(['flows', 'f', 'a', 'on', 'fail']);
    expect(reachOf(['flows', 'f', '$replace'])).toEqual(['flows', 'f']);
    expect(reachOf(['flows', '$replace'])).toEqual(['flows']);
    expect(reachOf(['$replace'])).toEqual([]);
    expect(reachOf([])).toEqual([]);
  });

  test('flattens every file entry\'s opaque paths, in entry then source order', () => {
    expect(opaqueReaches([[['a']], [], [['b', '$replace'], ['c']]])).toEqual([['a'], ['b'], ['c']]);
  });
});

describe('suppress: the merge-path prefix rule', () => {
  test('drops a finding whose path has an opaque path as a prefix, equals one, or is a prefix of one', () => {
    // Arrange
    const diagnostics = [at(['a', 'b']), at(['c']), at(['d']), at(['e', 'f'])];
    const reaches: readonly KeyPath[] = [['a'], ['c'], ['d', 'x', 'y']];

    // Act
    const kept = keptMergeFindings(diagnostics, reaches);

    // Assert
    expect(labels(kept)).toEqual(['duplicate-key@e.f']);
  });

  test('keeps a finding at a sibling, at a longer key sharing a string prefix, and at a dotted key', () => {
    // Arrange
    const diagnostics = [at(['a', 'c']), at(['ab']), at(['a.b'])];

    // Act
    const kept = keptMergeFindings(diagnostics, [['a', 'b']]);

    // Assert
    expect(kept).toEqual(diagnostics);
  });

  test('an entry opaque as a whole drops every merge finding', () => {
    expect(keptMergeFindings([at(['a']), at(['b', 'c'])], [[]])).toEqual([]);
  });

  test('drops the required-dropped an opaque parent makes under the placeholder, which a literal parent does not make', () => {
    // Arrange
    const opaque = analyseArray('[{ a: x }]', { required: ['a.b'] });
    const literal = analyseArray('[{ a: { b: 1 } }]', { required: ['a.b'] });

    // Act
    const findings = suppress(opaque);

    // Assert: the placeholder does make the finding, and the suppression drops it
    expect(labels(opaque.merge.diagnostics)).toEqual(['required-dropped@a.b']);
    expect(findings.merge).toEqual([]);
    expect(literal.merge.diagnostics).toEqual([]);
  });

  test('drops a duplicate-key at a path an opaque location lies under, and keeps the literal one', () => {
    // Arrange
    const opaque = analyseArray('[{ a: 1 }, { a: { b: x } }]');
    const literal = analyseArray('[{ a: 1 }, { a: { b: 2 } }]');

    // Act
    const opaqueFindings = suppress(opaque);
    const literalFindings = suppress(literal);

    // Assert
    expect(labels(opaque.merge.diagnostics)).toEqual(['duplicate-key@a']);
    expect(opaqueFindings.merge).toEqual([]);
    expect(labels(literalFindings.merge)).toEqual(['duplicate-key@a']);
  });

  test('keeps a merge finding no opaque location overlaps, in a file that has one elsewhere', () => {
    // Arrange
    const analysis = analyseArray('[{ a: 1, other: x }, { a: 2 }]');

    // Act
    const findings = suppress(analysis);

    // Assert
    expect(labels(findings.merge)).toEqual(['duplicate-key@a']);
    expect(findings.merge).toEqual(analysis.merge.diagnostics);
  });
});

describe('suppress: the per-flow graph rule', () => {
  test('drops every finding for a flow holding an opaque location, and keeps another flow\'s', () => {
    // Arrange: the opaque handler leaves `b` unreached and names the placeholder
    const analysis = analyseArray(
      `[{ flows: { f: { a: { step: 'lint', on: { fail: target } }, b: { step: 'fix' } }, g: ${JSON.stringify(FLOW_G)} } }]`,
      { steps: STEPS },
    );

    // Act
    const findings = suppress(analysis);

    // Assert: unreachable at flows.f.b does not overlap the opaque path, and is dropped all the same
    expect(labels(graphOf(analysis))).toEqual(['unknown-step@flows.f.a.on.fail', 'unreachable@flows.f.b', 'unreachable@flows.g.d']);
    expect(labels(findings.graph)).toEqual(['unreachable@flows.g.d']);
  });

  test('keeps the same flow\'s findings when the handler is a literal naming no step', () => {
    // Arrange
    const analysis = analyseArray(
      '[{ flows: { f: { a: { step: \'lint\', on: { fail: \'nowhere\' } }, b: { step: \'fix\' } } } }]',
      { steps: STEPS },
    );

    // Act
    const findings = suppress(analysis);

    // Assert
    expect(labels(findings.graph)).toEqual(['unknown-step@flows.f.a.on.fail', 'unreachable@flows.f.b']);
  });

  test('an opaque location at a flow, or at flows itself, drops that flow\'s findings or every flow\'s', () => {
    // Arrange
    const diagnostics = [at(['flows', 'f', 'b'], 'unreachable'), at(['flows', 'g', 'd'], 'unreachable')];

    // Act
    const byFlow = keptGraphFindings(diagnostics, [['flows', 'f']]);
    const byFlows = keptGraphFindings(diagnostics, [['flows']]);
    const byEntry = keptGraphFindings(diagnostics, [[]]);

    // Assert
    expect(labels(byFlow)).toEqual(['unreachable@flows.g.d']);
    expect(byFlows).toEqual([]);
    expect(byEntry).toEqual([]);
  });

  test('a finding naming no flow is kept only when no opaque location lies under flows at all', () => {
    // Arrange
    const diagnostics = [at([], 'cycle'), at(['flows'], 'cycle')];

    // Act
    const outsideFlows = keptGraphFindings(diagnostics, [['name']]);
    const underAFlow = keptGraphFindings(diagnostics, [['flows', 'f', 'a', 'on', 'fail']]);

    // Assert
    expect(outsideFlows).toEqual(diagnostics);
    expect(underAFlow).toEqual([]);
  });

  test('an opaque location outside flows drops no graph finding', () => {
    // Arrange
    const analysis = analyseArray(`[{ name: x, flows: { g: ${JSON.stringify(FLOW_G)} } }]`, { steps: STEPS });

    // Act
    const findings = suppress(analysis);

    // Assert
    expect(labels(findings.graph)).toEqual(['unreachable@flows.g.d']);
  });

  test('with no steps in settings no graph is resolved and no graph finding is kept', () => {
    // Arrange
    const analysis = analyseArray(`[{ flows: { g: ${JSON.stringify(FLOW_G)} } }]`);

    // Act
    const findings = suppress(analysis);

    // Assert
    expect(analysis.graph).toBeUndefined();
    expect(findings.graph).toEqual([]);
  });

  test('changes nothing it is given', () => {
    // Arrange
    const analysis = analyseArray(
      `[{ flows: { f: { a: { step: 'lint', on: { fail: target } }, b: { step: 'fix' } }, g: ${JSON.stringify(FLOW_G)} } }]`,
      { steps: STEPS },
    );
    const before = structuredClone({ opaque: analysis.opaque, merge: analysis.merge.diagnostics, graph: graphOf(analysis) });

    // Act
    suppress(analysis);

    // Assert
    expect({ opaque: analysis.opaque, merge: analysis.merge.diagnostics, graph: graphOf(analysis) }).toEqual(before);
  });
});

describe('suppress: $replace over a flow', () => {
  /** Defaults holding a sound flow `f` and flow `g`, whose `d` is unreachable. */
  const DEFAULTS = [{
    flows: {
      f: { a: { step: 'lint', on: { fail: 'b' } }, b: { step: 'fix' } },
      g: FLOW_G,
    },
  }];

  test('drops the findings of a flow the file replaces around an opaque value, and keeps the defaults\' other flow', () => {
    // Arrange
    const analysis = analyseArray(
      '[{ flows: { f: { $replace: true, a: { step: \'lint\', on: { fail: target } }, b: { step: \'fix\' } } } }]',
      { steps: STEPS, defaults: DEFAULTS },
    );

    // Act
    const findings = suppress(analysis);

    // Assert
    expect(labels(graphOf(analysis))).toEqual(['unknown-step@flows.f.a.on.fail', 'unreachable@flows.f.b', 'unreachable@flows.g.d']);
    expect(labels(findings.graph)).toEqual(['unreachable@flows.g.d']);
  });

  test('drops the findings of every flow a $replace over flows carries an opaque value into', () => {
    // Arrange
    const analysis = analyseArray(
      '[{ flows: { $replace: true, f: { a: { step: \'lint\', on: { fail: target } }, b: { step: \'fix\' } }, h: { c: { step: \'lint\' }, d: { step: \'fix\' } } } }]',
      { steps: STEPS, defaults: DEFAULTS },
    );

    // Act
    const findings = suppress(analysis);

    // Assert: g is replaced away; h is the file's own and holds no opaque value
    expect(labels(graphOf(analysis))).toEqual(['unknown-step@flows.f.a.on.fail', 'unreachable@flows.f.b', 'unreachable@flows.h.d']);
    expect(labels(findings.graph)).toEqual(['unreachable@flows.h.d']);
  });

  test('an opaque $replace over flows drops the defaults\' flow a literal true would replace away', () => {
    // Arrange
    const file = (replace: string): string => `[{ flows: { $replace: ${replace}, f: { a: { step: 'lint', on: { fail: 'b' } }, b: { step: 'fix' } } } }]`;
    const opaque = analyseArray(file('flag'), { steps: STEPS, defaults: DEFAULTS });
    const literal = analyseArray(file('true'), { steps: STEPS, defaults: DEFAULTS });

    // Act
    const findings = suppress(opaque);

    // Assert: the placeholder keeps g, a true $replace removes it, so its finding depends on flag
    expect(opaque.opaque).toEqual([[['flows', '$replace']]]);
    expect(labels(graphOf(opaque))).toEqual(['unreachable@flows.g.d']);
    expect(graphOf(literal)).toEqual([]);
    expect(findings.graph).toEqual([]);
  });

  test('an opaque $replace on a flow drops only that flow\'s findings', () => {
    // Arrange
    const analysis = analyseArray(
      '[{ flows: { g: { $replace: flag, c: { step: \'lint\' } } } }]',
      { steps: STEPS, defaults: DEFAULTS },
    );

    // Act
    const findings = suppress(analysis);

    // Assert: the placeholder merges into g and keeps d; a true $replace would drop d
    expect(labels(graphOf(analysis))).toEqual(['unreachable@flows.g.d']);
    expect(findings.graph).toEqual([]);
    expect(keptGraphFindings([at(['flows', 'f', 'b'], 'unreachable')], opaqueReaches(analysis.opaque))).toHaveLength(1);
  });

  test('an opaque $replace on the entry drops every merge and graph finding', () => {
    // Arrange
    const analysis = analyseArray(
      `[{ a: 1 }, { $replace: flag, a: 2, flows: { g: ${JSON.stringify(FLOW_G)} } }]`,
      { steps: STEPS },
    );

    // Act
    const findings = suppress(analysis);

    // Assert
    expect(labels(analysis.merge.diagnostics)).toEqual(['duplicate-key@a']);
    expect(labels(graphOf(analysis))).toEqual(['unreachable@flows.g.d']);
    expect(findings).toEqual({ merge: [], graph: [] });
  });
});
