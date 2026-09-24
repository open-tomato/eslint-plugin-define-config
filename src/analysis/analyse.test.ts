import type { Analysis } from './analyse';
import type { PluginSettings } from './settings';
import type { ReadEntries } from '../reader/read-entries';
import type { Diagnostic } from '@open-tomato/define-config';

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLoader, provenanceOf, resolveGraph } from '@open-tomato/define-config';
import { parse } from '@typescript-eslint/parser';
import { describe, expect, test } from 'bun:test';

import { OPAQUE, readEntries } from '../reader/read-entries';

import { analyse, DEFAULTS_LAYER, PLACEHOLDER, PROJECT_LAYER } from './analyse';
import { readSettings, SETTINGS_KEY } from './settings';

const IMPORT = 'import { defineConfig } from \'@open-tomato/define-config\';\n';

/** A registry with a step that ends `ok` or `fail`, and one that ends `ok`. */
const STEPS = { lint: { outcomes: ['ok', 'fail'] }, fix: { outcomes: ['ok'] } };

/** Read the entries of `defineConfig(<array>)`, or fail the test. */
const readArray = (array: string): ReadEntries => {
  const program = parse(`${IMPORT}export default defineConfig(${array});`, { sourceType: 'module', range: true, loc: true });
  const result = readEntries(program);
  if (result.kind !== 'entries') {
    throw new Error(`expected entries, got ${result.kind}`);
  }
  return result;
};

/** Check `raw` as the host's settings, or fail the test. */
const settingsOf = (raw: Readonly<Record<string, unknown>> = {}): PluginSettings => {
  const result = readSettings({ [SETTINGS_KEY]: raw });
  if (result.kind !== 'ok') {
    throw new Error(`expected ok settings, got ${JSON.stringify(result)}`);
  }
  return result.settings;
};

/** Analyse `defineConfig(<array>)` under the settings `raw`. */
const analyseArray = (array: string, raw?: Readonly<Record<string, unknown>>): Analysis => analyse(readArray(array), settingsOf(raw));

/** The codes of `diagnostics`, in order. */
const codes = (diagnostics: readonly Diagnostic[]): readonly string[] => diagnostics.map((diagnostic) => diagnostic.code);

/** The graph diagnostics of `analysis`, or fail the test when none were resolved. */
const graphDiagnostics = (analysis: Analysis): readonly Diagnostic[] => {
  if (analysis.graph === undefined) {
    throw new Error('expected a resolved graph');
  }
  return analysis.graph.diagnostics;
};

describe('PLACEHOLDER', () => {
  test('is a string no typed step id can spell, since step ids may not start with $', () => {
    expect(typeof PLACEHOLDER).toBe('string');
    expect(PLACEHOLDER.startsWith('$')).toBe(true);
    expect(PLACEHOLDER).not.toBe('$start');
    expect(PLACEHOLDER).not.toBe('$unattended');
  });

  test('never resolves as a step: a handler, a step name and a $start naming it are unknown', () => {
    // Arrange
    const flows = {
      f: { $start: PLACEHOLDER, a: { step: 'lint', on: { fail: PLACEHOLDER } }, b: { step: PLACEHOLDER } },
    };

    // Act
    const { diagnostics } = resolveGraph(flows, STEPS);

    // Assert
    const unknown = diagnostics.filter((diagnostic) => diagnostic.code === 'unknown-step').map((diagnostic) => diagnostic.path.join('.'));
    expect([...unknown].sort()).toEqual(['flows.f.$start', 'flows.f.a.on.fail', 'flows.f.b.step']);
  });
});

describe('analyse: layers', () => {
  test('stamps defaults with their own $layer or defaults, and every file entry with project', () => {
    // Arrange
    const defaults = [{ a: 1 }, { $layer: 'user', b: 2 }];
    const array = '[{ c: 3 }, { $layer: \'user\', d: 4 }]';

    // Act
    const analysis = analyseArray(array, { defaults });

    // Assert
    expect(analysis.entries.map((entry) => entry['$layer'])).toEqual([DEFAULTS_LAYER, 'user', PROJECT_LAYER, PROJECT_LAYER]);
    expect(DEFAULTS_LAYER).toBe('defaults');
    expect(PROJECT_LAYER).toBe('project');
    expect(provenanceOf(analysis.merge, 'd')).toEqual([{ entry: 3, layer: PROJECT_LAYER, kind: 'set' }]);
  });

  test('a key set once in defaults and once in the file is not a duplicate-key', () => {
    const analysis = analyseArray('[{ a: { x: 2 } }]', { defaults: [{ a: { x: 1 } }] });

    expect(analysis.merge.diagnostics).toEqual([]);
    expect(analysis.merge.value).toEqual({ a: { x: 2 } });
  });

  test('a $layer the file writes does not join a defaults layer, as the loader replaces it too', () => {
    // Arrange: control first, the same two entries both labelled defaults
    // collide, so the check could have fired.
    const defaults = [{ $layer: DEFAULTS_LAYER, a: 1 }];

    // Act
    const control = analyseArray('[]', { defaults: [...defaults, { $layer: DEFAULTS_LAYER, a: 2 }] });
    const analysis = analyseArray('[{ $layer: \'defaults\', a: 2 }]', { defaults });

    // Assert
    expect(codes(control.merge.diagnostics)).toEqual(['duplicate-key']);
    expect(analysis.merge.diagnostics).toEqual([]);
  });

  test('a key repeated within the file is a duplicate-key whose entry indexes defaults then file', () => {
    // Act
    const analysis = analyseArray('[{ a: 1 }, { b: 1 }, { a: 2 }]', { defaults: [{ z: 0 }, { y: 0 }] });

    // Assert
    expect(analysis.defaultsCount).toBe(2);
    expect(analysis.merge.diagnostics).toEqual([expect.objectContaining({ code: 'duplicate-key', path: ['a'], entry: 4 })]);
  });

  test('merges defaults in front of the file, so the file wins', () => {
    const analysis = analyseArray('[{ a: { y: 3 }, b: false }]', { defaults: [{ a: { x: 1, y: 2 }, b: 1 }] });

    expect(analysis.merge.value).toEqual({ a: { x: 1, y: 3 } });
    expect(provenanceOf(analysis.merge, 'b')).toEqual([
      { entry: 0, layer: DEFAULTS_LAYER, kind: 'set' },
      { entry: 1, layer: PROJECT_LAYER, kind: 'remove' },
    ]);
  });

  test('with no defaults, file entry i is merge entry i', () => {
    const analysis = analyseArray('[{ a: 1 }, { a: 2 }]');

    expect(analysis.defaultsCount).toBe(0);
    expect(analysis.merge.diagnostics).toEqual([expect.objectContaining({ code: 'duplicate-key', entry: 1 })]);
  });
});

describe('analyse: opaque values', () => {
  test('merges each opaque value as the placeholder and keeps the opaque paths per file entry', () => {
    // Arrange
    const read = readArray('[{ a: { x: 1, y: someName } }, { b: [1, other] }]');

    // Act
    const analysis = analyse(read, settingsOf());

    // Assert
    expect(analysis.merge.value).toEqual({ a: { x: 1, y: PLACEHOLDER }, b: PLACEHOLDER });
    expect(analysis.opaque).toEqual([[['a', 'y']], [['b']]]);
    expect(analysis.opaque).toEqual(read.opaque);
  });

  test('an entry opaque as a whole merges as an empty entry and keeps its index', () => {
    // Arrange: a top-level spread makes entry 0 opaque as a whole.
    const read = readArray('[{ ...base, a: 1 }, { b: 2 }, { b: 3 }]');

    // Act
    const analysis = analyse(read, settingsOf({ defaults: [{ z: 0 }] }));

    // Assert
    expect(read.entries[0]).toBe(OPAQUE);
    expect(analysis.entries[1]).toEqual({ $layer: PROJECT_LAYER });
    expect(analysis.opaque[0]).toEqual([[]]);
    expect(analysis.merge.value).toEqual({ z: 0, b: 3 });
    expect(analysis.merge.diagnostics).toEqual([expect.objectContaining({ code: 'duplicate-key', path: ['b'], entry: 3 })]);
  });

  test('an opaque value never removes a key: it is set, not dropped', () => {
    const analysis = analyseArray('[{ a: { x: flag } }]', { defaults: [{ a: { x: 1 } }], required: ['a.x'] });

    expect(analysis.merge.value).toEqual({ a: { x: PLACEHOLDER } });
    expect(analysis.merge.diagnostics).toEqual([]);
  });

  test('an opaque $replace does not replace, where a literal true does', () => {
    // Arrange
    const defaults = [{ a: { x: 1 } }];

    // Act
    const literal = analyseArray('[{ a: { $replace: true, y: 2 } }]', { defaults });
    const opaque = analyseArray('[{ a: { $replace: shouldReplace, y: 2 } }]', { defaults });

    // Assert
    expect(literal.merge.value).toEqual({ a: { y: 2 } });
    expect(opaque.merge.value).toEqual({ a: { x: 1, y: 2 } });
    expect(opaque.opaque).toEqual([[['a', '$replace']]]);
  });

  test('does not change the read entries or the settings it is given', () => {
    // Arrange
    const read = readArray('[{ a: { y: someName } }]');
    const settings = settingsOf({ defaults: [{ a: { x: 1 } }] });
    const before = structuredClone(settings.defaults);

    // Act
    analyse(read, settings);

    // Assert
    expect((read.entries[0] as { a: { y: unknown } }).a.y).toBe(OPAQUE);
    expect(settings.defaults).toEqual(before);
    expect(settings.defaults[0]).not.toHaveProperty('$layer');
  });
});

describe('analyse: merge options', () => {
  test('passes duplicates through: error raises the level, allow drops the finding', () => {
    // Arrange
    const array = '[{ a: 1 }, { a: 2 }]';

    // Act
    const warned = analyseArray(array);
    const raised = analyseArray(array, { duplicates: 'error' });
    const allowed = analyseArray(array, { duplicates: 'allow' });

    // Assert
    expect(warned.merge.diagnostics.map((diagnostic) => diagnostic.level)).toEqual(['warn']);
    expect(raised.merge.diagnostics.map((diagnostic) => diagnostic.level)).toEqual(['error']);
    expect(allowed.merge.diagnostics).toEqual([]);
  });

  test('passes required through: a path no entry sets is required-dropped with no entry', () => {
    const analysis = analyseArray('[{ a: 1 }]', { required: ['a', 'b.c'] });

    expect(analysis.merge.diagnostics).toEqual([expect.objectContaining({ code: 'required-dropped', path: ['b', 'c'] })]);
    expect(analysis.merge.diagnostics[0]).not.toHaveProperty('entry');
  });

  test('a file $replace dropping a required key set in defaults names the file entry', () => {
    const analysis = analyseArray('[{ a: { $replace: true, y: 2 } }]', { defaults: [{ a: { x: 1 } }], required: ['a.x'] });

    expect(analysis.merge.diagnostics).toEqual([expect.objectContaining({ code: 'required-dropped', path: ['a', 'x'], entry: 1 })]);
  });
});

describe('analyse: graph', () => {
  test('does not resolve the graph when the settings give no steps', () => {
    const analysis = analyseArray('[{ flows: { f: { a: { step: \'nope\' } } } }]');

    expect(analysis.graph).toBeUndefined();
  });

  test('resolves the merged flows with the settings\' steps', () => {
    // Arrange: the flow comes from defaults, the bad handler from the file.
    const defaults = [{ flows: { f: { a: { step: 'lint', on: { ok: 'b' } }, b: { step: 'fix' } } } }];

    // Act
    const analysis = analyseArray('[{ flows: { f: { a: { on: { missing: \'b\' } } } } }]', { defaults, steps: STEPS });

    // Assert
    expect(graphDiagnostics(analysis)).toEqual([expect.objectContaining({ code: 'unknown-outcome', path: ['flows', 'f', 'a', 'on', 'missing'] })]);
    expect(Object.keys(analysis.graph?.graph.nodes ?? {})).toEqual(['f.a', 'f.b']);
  });

  test('a flow valid in the file resolves with no graph finding', () => {
    const analysis = analyseArray('[{ flows: { f: { a: { step: \'lint\', on: { ok: \'b\', fail: \'b\' } }, b: { step: \'fix\' } } } }]', { steps: STEPS });

    expect(graphDiagnostics(analysis)).toEqual([]);
  });

  test('resolves an opaque handler target as the placeholder, which is unknown', () => {
    const analysis = analyseArray('[{ flows: { f: { a: { step: \'lint\', on: { ok: target } } } } }]', { steps: STEPS });

    expect(graphDiagnostics(analysis)).toEqual([expect.objectContaining({ code: 'unknown-step', path: ['flows', 'f', 'a', 'on', 'ok'] })]);
  });

  test('reads flows that are missing or not an object as no flows, as the loader does', () => {
    // Act
    const missing = analyseArray('[{ a: 1 }]', { steps: STEPS });
    const scalar = analyseArray('[{ flows: \'none\' }]', { steps: STEPS });
    const opaque = analyseArray('[{ flows: allFlows }]', { steps: STEPS });
    const array = analyseArray('[{ flows: [{ a: { step: \'nope\' } }] }]', { steps: STEPS });

    // Assert
    const all = [missing, scalar, opaque, array];
    expect(all.map(graphDiagnostics)).toEqual([[], [], [], []]);
    expect(all.map((analysis) => analysis.graph?.graph.nodes)).toEqual([{}, {}, {}, {}]);
  });
});

describe('analyse: parity with the loader', () => {
  test('gives the diagnostics createLoader gives for the same defaults and file', async () => {
    // Arrange: one duplicate within the file, one unknown outcome, one
    // required key the file drops, and a key both layers set.
    const defaults = [{ keep: { x: 1 }, flows: { f: { a: { step: 'lint', on: { ok: 'b' } }, b: { step: 'fix' } } } }];
    const file = [
      { keep: { $replace: true, y: 2 }, name: 'one' },
      { name: 'two', flows: { f: { a: { on: { nope: 'b' } } } } },
    ];
    const dir = await mkdtemp(join(tmpdir(), 'analyse-parity-'));
    try {
      await mkdir(join(dir, 'defaults'));
      await writeFile(join(dir, 'defaults', 'config.json'), JSON.stringify(defaults));
      await writeFile(join(dir, 'config.json'), JSON.stringify(file));
      const loader = createLoader({
        lookup: ['config.json'],
        layers: [{ layer: DEFAULTS_LAYER, dir: 'defaults' }, { layer: PROJECT_LAYER, dir: '.' }],
        steps: STEPS,
        required: ['keep.x'],
      });

      // Act
      const loaded = await loader.load(dir);
      const analysis = analyseArray(JSON.stringify(file), { defaults, steps: STEPS, required: ['keep.x'] });

      // Assert
      expect(codes(loaded.diagnostics)).toEqual(['duplicate-key', 'required-dropped', 'unknown-outcome']);
      expect([...analysis.merge.diagnostics, ...graphDiagnostics(analysis)]).toEqual([...loaded.diagnostics]);
      expect(analysis.merge.value).toEqual(loaded.config);
      expect(analysis.merge.provenance).toEqual(loaded.provenance);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
