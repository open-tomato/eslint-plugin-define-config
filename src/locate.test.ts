import type { Analysis } from './analysis/analyse';
import type { ReadEntries } from './reader/read-entries';
import type { Diagnostic, DiagnosticCode } from '@open-tomato/define-config';
import type { TSESTree } from '@typescript-eslint/types';

import { merge } from '@open-tomato/define-config';
import { parse } from '@typescript-eslint/parser';
import { describe, expect, test } from 'bun:test';

import { analyse } from './analysis/analyse';
import { readSettings, SETTINGS_KEY } from './analysis/settings';
import { suppress } from './analysis/suppress';
import {
  DEFAULTS_PREFIX,
  entryByProvenance,
  entryOf,
  locate,
  prefixesOf,
  walkPath,
} from './locate';
import { readEntries } from './reader/read-entries';

const IMPORT = 'import { defineConfig } from \'@open-tomato/define-config\';\n';

/** A registry: `lint` ends `ok` or `fail`, `fix` ends `ok`, `ask` ends `ok` and is interactive. */
const STEPS = {
  lint: { outcomes: ['ok', 'fail'] },
  fix: { outcomes: ['ok'] },
  ask: { outcomes: ['ok'], interactive: true },
};

/** The source of a config file passing `array` to `defineConfig(`. */
const sourceOf = (array: string): string => `${IMPORT}export default defineConfig(${array});\n`;

/** Read the file passing `array` to `defineConfig(`, or fail the test. */
const readArray = (array: string): ReadEntries => {
  const read = readEntries(parse(sourceOf(array), { sourceType: 'module', range: true, loc: true }));
  if (read.kind !== 'entries') {
    throw new Error(`expected entries, got ${read.kind}`);
  }
  return read;
};

/** The one element of `defineConfig([<object>])`, or fail the test. */
const elementOf = (object: string): TSESTree.ObjectExpression => {
  const [element] = readArray(`[${object}]`).elements;
  if (element === undefined) {
    throw new Error('expected one element');
  }
  return element;
};

/** The file read from `array` and its analysis under the settings `raw`. */
interface Analysed {
  readonly source: string;
  readonly read: ReadEntries;
  readonly analysis: Analysis;
}

/** Read and analyse `defineConfig(<array>)` under the settings `raw`, or fail the test. */
const analyseArray = (array: string, raw: Readonly<Record<string, unknown>>): Analysed => {
  const read = readArray(array);
  const settings = readSettings({ [SETTINGS_KEY]: raw });
  if (settings.kind !== 'ok') {
    throw new Error(`expected ok settings, got ${JSON.stringify(settings)}`);
  }
  return { source: sourceOf(array), read, analysis: analyse(read, settings.settings) };
};

/** The one surviving finding of `code` and the stage that produced it, or fail the test. */
const findingOf = (analysis: Analysis, code: DiagnosticCode): readonly [Diagnostic, 'merge' | 'graph'] => {
  const findings = suppress(analysis);
  const found = [
    ...findings.merge.map((diagnostic) => [diagnostic, 'merge'] as const),
    ...findings.graph.map((diagnostic) => [diagnostic, 'graph'] as const),
  ].filter(([diagnostic]) => diagnostic.code === code);
  const [first] = found;
  if (first === undefined || found.length !== 1) {
    throw new Error(`expected one ${code}, got ${found.length}`);
  }
  return first;
};

/** The key a `Property` node is written under, as its source text. */
const keyText = (node: TSESTree.Node, source: string): string => {
  if (node.type !== 'Property') {
    throw new Error(`expected a Property, got ${node.type}`);
  }
  return source.slice(...node.key.range);
};

/** The 1-based line of the one line of `source` holding `marker`, or fail the test. */
const lineOf = (source: string, marker: string): number => {
  const lines = source.split('\n');
  const matches = lines.filter((line) => line.includes(marker));
  if (matches.length !== 1) {
    throw new Error(`expected one line holding ${marker}, got ${matches.length}`);
  }
  return lines.findIndex((line) => line.includes(marker)) + 1;
};

describe('prefixesOf', () => {
  test('lists the path down to the empty path, longest first', () => {
    // Arrange
    const path = ['flows', 'f', 'a'];

    // Act
    const prefixes = prefixesOf(path);

    // Assert
    expect(prefixes).toEqual([['flows', 'f', 'a'], ['flows', 'f'], ['flows'], []]);
  });

  test('gives the empty path alone for the empty path', () => {
    // Arrange
    const path: string[] = [];

    // Act
    const prefixes = prefixesOf(path);

    // Assert
    expect(prefixes).toEqual([[]]);
  });
});

describe('entryByProvenance', () => {
  test('takes the last writer at the path itself', () => {
    // Arrange
    const result = merge([{ a: { b: 1 } }, { a: { b: 2 } }]);

    // Act
    const entry = entryByProvenance(result, ['a', 'b']);

    // Assert
    expect(entry).toBe(1);
  });

  test('takes the longest prefix with a record when the path itself has none', () => {
    // Arrange
    const result = merge([{ a: { b: 1 } }, { a: { c: 2 } }]);

    // Act
    const entry = entryByProvenance(result, ['a', 'b', 'x', 'y']);

    // Assert
    expect(entry).toBe(0);
  });

  test('passes over a remove record for the last set before it', () => {
    // Arrange
    const result = merge([{ a: { b: 1 } }, { a: { b: 2 } }, { a: { b: false } }]);

    // Act
    const entry = entryByProvenance(result, ['a', 'b']);

    // Assert
    expect(entry).toBe(1);
  });

  test('passes over a prefix holding only removals for a shorter one', () => {
    // Arrange
    const result = merge([{ a: { x: 1 } }, { a: { b: false } }]);

    // Act
    const entry = entryByProvenance(result, ['a', 'b']);

    // Assert
    expect(entry).toBe(0);
  });

  test('counts a replace record as a write', () => {
    // Arrange
    const result = merge([{ x: { y: 1 } }, { x: { $replace: true, z: 2 } }]);

    // Act
    const entry = entryByProvenance(result, ['x', 'w']);

    // Assert
    expect(entry).toBe(1);
  });

  test('finds a record a dotted key wrote at the path it spells', () => {
    // Arrange
    const result = merge([{ a: { b: 1 } }, { 'a.b': 2 }]);

    // Act
    const entry = entryByProvenance(result, ['a', 'b']);

    // Assert
    expect(entry).toBe(1);
  });

  test('is undefined when no prefix was ever written', () => {
    // Arrange
    const result = merge([{ a: 1 }, { b: false }]);

    // Act
    const entry = entryByProvenance(result, ['b']);

    // Assert
    expect(entry).toBeUndefined();
  });
});

describe('entryOf', () => {
  const result = merge([{ a: 1 }, { a: 2 }, { b: 3 }]);

  test('uses a merge finding\'s own entry over provenance', () => {
    // Arrange
    const diagnostic: Diagnostic = { level: 'warn', code: 'duplicate-key', path: ['a'], message: 'm', entry: 2 };

    // Act
    const entry = entryOf(diagnostic, 'merge', result);

    // Assert
    expect(entry).toBe(2);
  });

  test('falls back to provenance for a merge finding with no entry', () => {
    // Arrange
    const diagnostic: Diagnostic = { level: 'error', code: 'required-dropped', path: ['a'], message: 'm' };

    // Act
    const entry = entryOf(diagnostic, 'merge', result);

    // Assert
    expect(entry).toBe(1);
  });

  test('ignores an entry on a graph finding and reads provenance', () => {
    // Arrange
    const diagnostic: Diagnostic = { level: 'error', code: 'unknown-step', path: ['b'], message: 'm', entry: 0 };

    // Act
    const entry = entryOf(diagnostic, 'graph', result);

    // Assert
    expect(entry).toBe(2);
  });
});

describe('walkPath', () => {
  test('reaches the deepest property on the path', () => {
    // Arrange
    const source = '{ flows: { f: {\n  a: { step: \'nope\' },\n} } }';
    const element = elementOf(source);

    // Act
    const node = walkPath(element, ['flows', 'f', 'a', 'step']);

    // Assert
    expect(keyText(node, sourceOf(`[${source}]`))).toBe('step');
    expect(node.loc.start.line).toBe(lineOf(sourceOf(`[${source}]`), 'nope'));
  });

  test('returns the element itself when the first key misses', () => {
    // Arrange
    const element = elementOf('{ flows: { f: {} } }');

    // Act
    const node = walkPath(element, ['other', 'f']);

    // Assert
    expect(node).toBe(element);
  });

  test('returns the element itself for the empty path', () => {
    // Arrange
    const element = elementOf('{ a: 1 }');

    // Act
    const node = walkPath(element, []);

    // Assert
    expect(node).toBe(element);
  });

  test('stops at the last property reached when a later key misses', () => {
    // Arrange
    const source = '{ flows: { f: { a: {} } } }';
    const element = elementOf(source);

    // Act
    const node = walkPath(element, ['flows', 'f', 'b', 'step']);

    // Assert
    expect(keyText(node, sourceOf(`[${source}]`))).toBe('f');
  });

  test('stops at a property whose value is not an object literal', () => {
    // Arrange
    const source = '{ a: target, b: [1] }';
    const element = elementOf(source);

    // Act
    const reached = [walkPath(element, ['a', 'x']), walkPath(element, ['b', '0'])];

    // Assert
    expect(reached.map((node) => keyText(node, sourceOf(`[${source}]`)))).toEqual(['a', 'b']);
  });

  test('matches a dotted key against the keys it spans', () => {
    // Arrange
    const source = '{ flows: { \'f.a\': { step: \'nope\' } } }';
    const element = elementOf(source);

    // Act
    const node = walkPath(element, ['flows', 'f', 'a', 'step']);

    // Assert
    expect(keyText(node, sourceOf(`[${source}]`))).toBe('step');
  });

  test('matches a dotted key that ends the path', () => {
    // Arrange
    const source = '{ \'a.b\': 1 }';
    const element = elementOf(source);

    // Act
    const node = walkPath(element, ['a', 'b']);

    // Assert
    expect(keyText(node, sourceOf(`[${source}]`))).toBe('\'a.b\'');
  });

  test('matches a path key holding a dot with the key written whole', () => {
    // Arrange
    const source = '{ \'a.b\': { c: 1 } }';
    const element = elementOf(source);

    // Act
    const node = walkPath(element, ['a.b', 'c']);

    // Assert
    expect(keyText(node, sourceOf(`[${source}]`))).toBe('c');
  });

  test('does not match a key that only starts like the path key', () => {
    // Arrange
    const element = elementOf('{ ab: 1, \'a.bc\': 2 }');

    // Act
    const node = walkPath(element, ['a', 'b']);

    // Assert
    expect(node).toBe(element);
  });

  test('takes the last of a key written twice in one literal', () => {
    // Arrange
    const element = elementOf('{ a: 1, a: 2 }');

    // Act
    const node = walkPath(element, ['a']);

    // Assert
    expect(node).toBe(element.properties[1] as TSESTree.Property);
  });

  test('walks through `as` and `satisfies` around a value', () => {
    // Arrange
    const source = '{ a: { b: { c: 1 } as const } satisfies object }';
    const element = elementOf(source);

    // Act
    const node = walkPath(element, ['a', 'b', 'c']);

    // Assert
    expect(keyText(node, sourceOf(`[${source}]`))).toBe('c');
  });

  test('skips spreads and computed keys', () => {
    // Arrange
    const element = elementOf('{ ...rest, [key]: 1, a: 2 }');

    // Act
    const node = walkPath(element, ['key']);

    // Assert
    expect(node).toBe(element);
  });
});

/** One code located in the file: the config, its settings, and the key and line it lands on. */
interface FileCase {
  readonly code: DiagnosticCode;
  readonly array: string;
  readonly settings: Readonly<Record<string, unknown>>;
  /** The key text of the `Property` the finding lands on. */
  readonly key: string;
  /** A substring found on the finding's line only. */
  readonly marker: string;
}

/** One `defaults` entry in front of every file case, so a merge index is never a file index. */
const SEED = [{ seed: true }];

const FILE_CASES: readonly FileCase[] = [
  {
    code: 'duplicate-key',
    array: '[\n  { a: 1 },\n  { a: 2 }, // here\n]',
    settings: { defaults: SEED },
    key: 'a',
    marker: '// here',
  },
  {
    code: 'required-dropped',
    array: '[\n  { a: 1 },\n  { a: false }, // here\n  { b: 1 },\n]',
    settings: { defaults: SEED, required: ['a'] },
    key: 'a',
    marker: '// here',
  },
  {
    code: 'handler-conflict',
    array: '[{ flows: { f: {\n  a: { step: \'lint\', on: { ok: \'b\' }, onFail: \'b\' }, // here\n  b: { step: \'fix\' },\n} } }]',
    settings: { defaults: SEED, steps: STEPS },
    key: 'a',
    marker: '// here',
  },
  {
    code: 'unknown-step',
    array: '[{ flows: { f: {\n  a: { step: \'nope\' }, // here\n} } }]',
    settings: { defaults: SEED, steps: STEPS },
    key: 'step',
    marker: '// here',
  },
  {
    code: 'unknown-outcome',
    array: '[{ flows: { f: {\n  a: { step: \'fix\',\n    on: { fail: \'b\' } }, // here\n  b: { step: \'fix\' },\n} } }]',
    settings: { defaults: SEED, steps: STEPS },
    key: 'fail',
    marker: '// here',
  },
  {
    code: 'impure-when',
    array: '[{ flows: { f: {\n  a: { step: \'lint\' },\n  b: { step: \'fix\',\n    when: \'after:a\' }, // here\n} } }]',
    settings: { defaults: SEED, steps: STEPS },
    key: 'when',
    marker: '// here',
  },
  {
    code: 'cycle',
    array: '[{ flows: { f: {\n  a: { step: \'lint\', on: { ok: \'b\' } },\n  b: { step: \'fix\', on: { ok: \'a\' } }, // here\n} } }]',
    settings: { defaults: SEED, steps: STEPS },
    key: 'ok',
    marker: '// here',
  },
  {
    code: 'interactive-unattended',
    array: '[{ flows: { f: {\n  $unattended: true,\n  a: { step: \'ask\' }, // here\n} } }]',
    settings: { defaults: SEED, steps: STEPS },
    key: 'a',
    marker: '// here',
  },
  {
    code: 'unreachable',
    array: '[{ flows: { f: {\n  a: { step: \'lint\', on: { ok: \'b\' } },\n  b: { step: \'fix\' },\n  c: { step: \'fix\' }, // here\n} } }]',
    settings: { defaults: SEED, steps: STEPS },
    key: 'c',
    marker: '// here',
  },
];

/** One code owned by a `defaults` entry: the defaults, the file's array, and the settings besides. */
interface DefaultsCase {
  readonly code: DiagnosticCode;
  readonly defaults: readonly Readonly<Record<string, unknown>>[];
  readonly settings: Readonly<Record<string, unknown>>;
}

const FLOW_SETTINGS = { steps: STEPS };

const DEFAULTS_CASES: readonly DefaultsCase[] = [
  { code: 'duplicate-key', defaults: [{ a: 1 }, { a: 2 }], settings: {} },
  { code: 'required-dropped', defaults: [{ a: 1 }, { a: false }], settings: { required: ['a'] } },
  {
    code: 'handler-conflict',
    defaults: [{ flows: { f: { a: { step: 'lint', on: { ok: 'b' }, onFail: 'b' }, b: { step: 'fix' } } } }],
    settings: FLOW_SETTINGS,
  },
  { code: 'unknown-step', defaults: [{ flows: { f: { a: { step: 'nope' } } } }], settings: FLOW_SETTINGS },
  {
    code: 'unknown-outcome',
    defaults: [{ flows: { f: { a: { step: 'fix', on: { fail: 'b' } }, b: { step: 'fix' } } } }],
    settings: FLOW_SETTINGS,
  },
  {
    code: 'impure-when',
    defaults: [{ flows: { f: { a: { step: 'lint', on: { ok: 'b' } }, b: { step: 'fix', when: 'after:a' } } } }],
    settings: FLOW_SETTINGS,
  },
  {
    code: 'cycle',
    defaults: [{ flows: { f: { a: { step: 'lint', on: { ok: 'b' } }, b: { step: 'fix', on: { ok: 'a' } } } } }],
    settings: FLOW_SETTINGS,
  },
  {
    code: 'interactive-unattended',
    defaults: [{ flows: { f: { $unattended: true, a: { step: 'ask' } } } }],
    settings: FLOW_SETTINGS,
  },
  {
    code: 'unreachable',
    defaults: [{ flows: { f: { a: { step: 'lint', on: { ok: 'b' } }, b: { step: 'fix' }, c: { step: 'fix' } } } }],
    settings: FLOW_SETTINGS,
  },
];

describe('locate, per code', () => {
  test('covers the nine reported codes in the file and in defaults', () => {
    // Arrange
    const nine: DiagnosticCode[] = [
      'cycle',
      'duplicate-key',
      'handler-conflict',
      'impure-when',
      'interactive-unattended',
      'required-dropped',
      'unknown-outcome',
      'unknown-step',
      'unreachable',
    ];

    // Act
    const inFile = FILE_CASES.map((item) => item.code);
    const inDefaults = DEFAULTS_CASES.map((item) => item.code);

    // Assert
    expect([...inFile].sort()).toEqual(nine);
    expect([...inDefaults].sort()).toEqual(nine);
  });

  for (const item of FILE_CASES) {
    test(`${item.code}: lands on \`${item.key}\` at the line it was written, unprefixed`, () => {
      // Arrange
      const { source, read, analysis } = analyseArray(item.array, item.settings);
      const [diagnostic, stage] = findingOf(analysis, item.code);

      // Act
      const located = locate(diagnostic, stage, read, analysis);

      // Assert
      expect(keyText(located.node, source)).toBe(item.key);
      expect(located.node.loc.start.line).toBe(lineOf(source, item.marker));
      expect(located.message).toBe(diagnostic.message);
    });
  }

  for (const item of DEFAULTS_CASES) {
    test(`${item.code}: owned by defaults, lands on the callee prefixed`, () => {
      // Arrange
      const { read, analysis } = analyseArray('[\n  { other: 1 },\n]', { ...item.settings, defaults: item.defaults });
      const [diagnostic, stage] = findingOf(analysis, item.code);

      // Act
      const located = locate(diagnostic, stage, read, analysis);

      // Assert
      expect(located.node).toBe(read.call.callee);
      expect(located.message).toBe(`${DEFAULTS_PREFIX} ${diagnostic.message}`);
    });
  }
});

describe('locate, entry resolution', () => {
  test('subtracts the defaults count from a merge finding\'s entry', () => {
    // Arrange
    const { read, analysis } = analyseArray('[{ a: 1 }, { b: 1 }, { a: 2 }]', { defaults: [{ x: 1 }, { y: 1 }] });
    const [diagnostic, stage] = findingOf(analysis, 'duplicate-key');

    // Act
    const located = locate(diagnostic, stage, read, analysis);

    // Assert
    expect(diagnostic.entry).toBe(4);
    expect(located.node).toBe(read.elements[2]?.properties[0] as TSESTree.Property);
  });

  test('ties a graph finding to the file entry that last set its path', () => {
    // Arrange
    const array = '[\n  { flows: { f: { a: { step: \'fix\' }, b: { step: \'fix\' } } } },\n'
      + '  { flows: { f: { a: { on: { fail: \'b\' } } } } }, // here\n]';
    const { source, read, analysis } = analyseArray(array, FLOW_SETTINGS);
    const [diagnostic, stage] = findingOf(analysis, 'unknown-outcome');

    // Act
    const located = locate(diagnostic, stage, read, analysis);

    // Assert
    expect(keyText(located.node, source)).toBe('fail');
    expect(located.node.loc.start.line).toBe(lineOf(source, '// here'));
  });

  test('ties a graph finding to the entry that started its map, not one that merged into it', () => {
    // Arrange
    const array = '[\n  { flows: { f: { a: { step: \'lint\', on: { ok: \'b\' } }, b: { step: \'fix\' } } } }, // here\n'
      + '  { flows: { f: { a: { onFail: \'b\' } } } },\n]';
    const { source, read, analysis } = analyseArray(array, FLOW_SETTINGS);
    const [diagnostic, stage] = findingOf(analysis, 'handler-conflict');

    // Act
    const located = locate(diagnostic, stage, read, analysis);

    // Assert
    expect(diagnostic.path).toEqual(['flows', 'f', 'a']);
    expect(keyText(located.node, source)).toBe('a');
    expect(located.node.loc.start.line).toBe(lineOf(source, '// here'));
  });

  test('walks a dotted key the file wrote to the finding\'s property', () => {
    // Arrange
    const array = '[\n  { a: { b: 1 } },\n  { \'a.b\': 2 }, // here\n]';
    const { source, read, analysis } = analyseArray(array, {});
    const [diagnostic, stage] = findingOf(analysis, 'duplicate-key');

    // Act
    const located = locate(diagnostic, stage, read, analysis);

    // Assert
    expect(keyText(located.node, source)).toBe('\'a.b\'');
    expect(located.node.loc.start.line).toBe(lineOf(source, '// here'));
  });

  test('reports on the element when the finding\'s first key is not written there', () => {
    // Arrange
    const { read, analysis } = analyseArray('[{ a: 1 }]', {});
    const diagnostic: Diagnostic = { level: 'error', code: 'required-dropped', path: ['z'], message: 'm', entry: 0 };

    // Act
    const located = locate(diagnostic, 'merge', read, analysis);

    // Assert
    expect(located.node).toBe(read.elements[0] as TSESTree.ObjectExpression);
  });

  test('reports a finding with no entry and no provenance on the call, unprefixed', () => {
    // Arrange
    const { read, analysis } = analyseArray('[{ a: 1 }]', { defaults: SEED, required: ['x'] });
    const [diagnostic, stage] = findingOf(analysis, 'required-dropped');

    // Act
    const located = locate(diagnostic, stage, read, analysis);

    // Assert
    expect(diagnostic.entry).toBeUndefined();
    expect(located.node).toBe(read.call);
    expect(located.message).toBe(diagnostic.message);
  });

  test('reports on the call when an entry index names no element', () => {
    // Arrange
    const { read, analysis } = analyseArray('[{ a: 1 }]', {});
    const diagnostic: Diagnostic = { level: 'warn', code: 'duplicate-key', path: ['a'], message: 'm', entry: 5 };

    // Act
    const located = locate(diagnostic, 'merge', read, analysis);

    // Assert
    expect(located.node).toBe(read.call);
    expect(located.message).toBe('m');
  });

  test('prefixes only the defaults case: the same finding in the file is unprefixed', () => {
    // Arrange
    const inFile = analyseArray('[{ a: 1 }, { a: 2 }]', {});
    const inDefaults = analyseArray('[{ b: 1 }]', { defaults: [{ a: 1 }, { a: 2 }] });
    const [fileFinding] = findingOf(inFile.analysis, 'duplicate-key');
    const [defaultsFinding] = findingOf(inDefaults.analysis, 'duplicate-key');

    // Act
    const located = [
      locate(fileFinding, 'merge', inFile.read, inFile.analysis),
      locate(defaultsFinding, 'merge', inDefaults.read, inDefaults.analysis),
    ];

    // Assert
    expect(located.map((item) => item.message.startsWith(DEFAULTS_PREFIX))).toEqual([false, true]);
  });
});

describe('locate, defaults against the file', () => {
  test('a handler set in defaults and overridden in the file is reported on the file\'s line', () => {
    // Arrange
    const defaults = [{ flows: { f: { a: { step: 'fix', on: { fail: 'b' } }, b: { step: 'fix' } } } }];
    const array = '[\n  { flows: { f: { a: { on: { fail: \'b\' } } } } }, // here\n]';
    const { source, read, analysis } = analyseArray(array, { ...FLOW_SETTINGS, defaults });
    const [diagnostic, stage] = findingOf(analysis, 'unknown-outcome');

    // Act
    const located = locate(diagnostic, stage, read, analysis);

    // Assert
    expect(keyText(located.node, source)).toBe('fail');
    expect(located.node.loc.start.line).toBe(lineOf(source, '// here'));
    expect(located.message).toBe(diagnostic.message);
  });

  test('a handler set in the file and also set in defaults is reported on the file\'s line', () => {
    // Arrange
    const defaults = [{ flows: { f: { a: { step: 'fix', on: { fail: 'b' } }, b: { step: 'fix' } } } }];
    const array = '[\n  { flows: { f: { a: { step: \'fix\', on: { fail: \'c\' } }, c: { step: \'fix\' } } } }, // here\n]';
    const { source, read, analysis } = analyseArray(array, { ...FLOW_SETTINGS, defaults });
    const [diagnostic, stage] = findingOf(analysis, 'unknown-outcome');

    // Act
    const located = locate(diagnostic, stage, read, analysis);

    // Assert
    expect(located.message.startsWith(DEFAULTS_PREFIX)).toBe(false);
    expect(located.node.loc.start.line).toBe(lineOf(source, '// here'));
  });
});
