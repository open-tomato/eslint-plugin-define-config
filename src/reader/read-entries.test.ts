import type { ReadEntries, ReadResult } from './read-entries';
import type { TSESTree } from '@typescript-eslint/types';

import { parse } from '@typescript-eslint/parser';
import { describe, expect, test } from 'bun:test';

import { OPAQUE, readEntries } from './read-entries';

const IMPORT = 'import { defineConfig } from \'@open-tomato/define-config\';\n';

/** Parse `source` as a TypeScript module, the way eslint hands it to a rule. */
const program = (source: string): TSESTree.Program => parse(source, { sourceType: 'module', range: true, loc: true });

/** Read a file made of the standard import and `body`. */
const read = (body: string): ReadResult => readEntries(program(`${IMPORT}${body}`));

/** The source text of the result's `defineConfig(` call, when it has one. */
const callText = (source: string, result: ReadResult): string | undefined => {
  if (result.kind === 'none') {
    return undefined;
  }
  return source.slice(...result.call.range);
};

/** Read `body` and fail the test unless the file yields entries. */
const readOk = (body: string): ReadEntries => {
  const result = read(body);
  if (result.kind !== 'entries') {
    throw new Error(`expected entries, got ${result.kind}`);
  }
  return result;
};

describe('readEntries: literal values', () => {
  test('reads strings, numbers, booleans, null and expression-free templates', () => {
    // Arrange
    const body = 'export default defineConfig([{ s: \'x\', d: "y", n: 1.5, t: true, f: false, z: null, tpl: `plain` }]);';

    // Act
    const result = readOk(body);

    // Assert
    expect(result.entries).toEqual([{ s: 'x', d: 'y', n: 1.5, t: true, f: false, z: null, tpl: 'plain' }]);
    expect(result.opaque).toEqual([[]]);
  });

  test('reads a unary minus on a number as a negative number', () => {
    const result = readOk('defineConfig([{ low: -3, zero: -0 }]);');

    expect(result.entries).toEqual([{ low: -3, zero: -0 }]);
    expect(Object.is((result.entries[0] as { zero: number }).zero, -0)).toBe(true);
    expect(result.opaque).toEqual([[]]);
  });

  test('reads arrays of literals, including literal objects inside them', () => {
    const result = readOk('defineConfig([{ list: [1, \'two\', null, [false], { k: -1 }] }]);');

    expect(result.entries).toEqual([{ list: [1, 'two', null, [false], { k: -1 }] }]);
    expect(result.opaque).toEqual([[]]);
  });

  test('keeps the reserved keys `$replace`, `$layer` and a removing `false` as written', () => {
    const result = readOk('defineConfig([{ $layer: \'mine\', steps: { lint: false, build: { $replace: true, run: \'b\' } } }]);');

    expect(result.entries).toEqual([
      { $layer: 'mine', steps: { lint: false, build: { $replace: true, run: 'b' } } },
    ]);
  });

  test('reads numeric and quoted keys as strings, in runtime key order', () => {
    // Arrange: integer-like keys come first at runtime, whatever the source order.
    const body = 'defineConfig([{ b: 1, 2: \'two\', \'q-k\': 3, 0x1: \'one\' }]);';

    // Act
    const entry = readOk(body).entries[0];

    // Assert
    expect(entry).toEqual({ b: 1, 2: 'two', 'q-k': 3, 1: 'one' });
    expect(Object.keys(entry as object)).toEqual(Object.keys({ b: 1, 2: 'two', 'q-k': 3, 0x1: 'one' }));
  });

  test('lets a repeated key keep its last value, as the runtime does', () => {
    const result = readOk('defineConfig([{ a: target, b: 1, a: 2 }]);');

    expect(result.entries).toEqual([{ a: 2, b: 1 }]);
    expect(Object.keys(result.entries[0] as object)).toEqual(['a', 'b']);
    expect(result.opaque).toEqual([[]]);
  });

  test('unwraps `as` and `satisfies` around the argument, an element and a value', () => {
    const body = 'defineConfig([{ a: 1 as const, b: { c: \'x\' } satisfies object } as Entry] as Entry[]);';

    expect(readOk(body).entries).toEqual([{ a: 1, b: { c: 'x' } }]);
  });

  test('reads each element in order, one entry per element', () => {
    const result = readOk('defineConfig([{ a: 1 }, { a: 2 }, {}]);');

    expect(result.entries).toEqual([{ a: 1 }, { a: 2 }, {}]);
    expect(result.opaque).toEqual([[], [], []]);
  });
});

describe('readEntries: nested maps', () => {
  test('reads maps nested several levels deep', () => {
    // Arrange
    const body = [
      'defineConfig([',
      '  { flows: { main: { $start: \'build\', build: { step: \'build\', on: { ok: \'test\' } } } } },',
      '  { handlers: { build: { retries: 2 } } },',
      ']);',
    ].join('\n');

    // Act
    const result = readOk(body);

    // Assert
    expect(result.entries).toEqual([
      { flows: { main: { $start: 'build', build: { step: 'build', on: { ok: 'test' } } } } },
      { handlers: { build: { retries: 2 } } },
    ]);
    expect(result.opaque).toEqual([[], []]);
  });

  test('records an opaque value deep in a map at its full path, keeping its siblings', () => {
    const result = readOk('defineConfig([{ flows: { main: { build: { step: \'build\', on: { fail: target } } } } }]);');

    expect(result.entries).toEqual([
      { flows: { main: { build: { step: 'build', on: { fail: OPAQUE } } } } },
    ]);
    expect(result.opaque).toEqual([[['flows', 'main', 'build', 'on', 'fail']]]);
  });
});

describe('readEntries: dotted keys', () => {
  test('keeps a dotted key as one key, not as the nested keys it spells', () => {
    const result = readOk('defineConfig([{ \'a.b\': 1, a: { b: 2 } }]);');

    expect(result.entries).toEqual([{ 'a.b': 1, a: { b: 2 } }]);
  });

  test('records an opaque value under a dotted key as one path segment', () => {
    // Arrange / Act
    const result = readOk('defineConfig([{ \'flows.main\': target, flows: { main: other } }]);');

    // Assert: the two paths spell the same dot-joined string, and stay apart as arrays.
    expect(result.opaque).toEqual([[['flows.main'], ['flows', 'main']]]);
    expect(result.entries).toEqual([{ 'flows.main': OPAQUE, flows: { main: OPAQUE } }]);
  });
});

describe('readEntries: identifiers', () => {
  test('makes an identifier value opaque at its path', () => {
    const result = readOk('import { target } from \'./steps\';\ndefineConfig([{ on: { fail: target }, run: \'x\' }]);');

    expect(result.entries).toEqual([{ on: { fail: OPAQUE }, run: 'x' }]);
    expect(result.opaque).toEqual([[['on', 'fail']]]);
  });

  test('makes a shorthand property opaque at its key', () => {
    const result = readOk('defineConfig([{ target }]);');

    expect(result.entries).toEqual([{ target: OPAQUE }]);
    expect(result.opaque).toEqual([[['target']]]);
  });

  test('makes `undefined` and member access opaque', () => {
    const result = readOk('defineConfig([{ u: undefined, m: steps.build, n: -limit }]);');

    expect(result.entries).toEqual([{ u: OPAQUE, m: OPAQUE, n: OPAQUE }]);
    expect(result.opaque).toEqual([[['u'], ['m'], ['n']]]);
  });

  test('makes an array holding an identifier opaque as a whole', () => {
    const result = readOk('defineConfig([{ list: [1, target] }]);');

    expect(result.entries).toEqual([{ list: OPAQUE }]);
    expect(result.opaque).toEqual([[['list']]]);
  });
});

describe('readEntries: calls and other non-literals', () => {
  test('makes a call opaque at its path', () => {
    const result = readOk('defineConfig([{ steps: { build: make(\'build\') } }]);');

    expect(result.entries).toEqual([{ steps: { build: OPAQUE } }]);
    expect(result.opaque).toEqual([[['steps', 'build']]]);
  });

  test.each([
    ['a template with an expression', '`run ${name}`'],
    ['a tagged template', 'tag`plain`'],
    ['a regular expression', '/x/'],
    ['a bigint', '1n'],
    ['a unary plus', '+1'],
    ['a negation', '!0'],
    ['a function', '() => 1'],
    ['a `new` expression', 'new Map()'],
    ['a binary expression', '1 + 1'],
  ])('makes %s opaque', (_name, value) => {
    const result = readOk(`defineConfig([{ v: ${value} }]);`);

    expect(result.entries).toEqual([{ v: OPAQUE }]);
    expect(result.opaque).toEqual([[['v']]]);
  });

  test('makes a method and an accessor opaque at their keys', () => {
    const result = readOk('defineConfig([{ run() { return 1; }, get size() { return 2; }, n: 1 }]);');

    expect(result.entries).toEqual([{ run: OPAQUE, size: OPAQUE, n: 1 }]);
    expect(result.opaque).toEqual([[['run'], ['size']]]);
  });
});

describe('readEntries: spreads and computed keys', () => {
  test('makes the object holding a spread opaque as a whole', () => {
    const result = readOk('defineConfig([{ keep: 1, steps: { ...base, build: \'b\' } }]);');

    expect(result.entries).toEqual([{ keep: 1, steps: OPAQUE }]);
    expect(result.opaque).toEqual([[['steps']]]);
  });

  test('makes the object holding a computed key opaque, even when the key is a literal', () => {
    const result = readOk('defineConfig([{ keep: 1, steps: { [\'build\']: \'b\' }, flows: { [name]: {} } }]);');

    expect(result.entries).toEqual([{ keep: 1, steps: OPAQUE, flows: OPAQUE }]);
    expect(result.opaque).toEqual([[['steps'], ['flows']]]);
  });

  test('makes the object holding a `__proto__` setter opaque', () => {
    const result = readOk('defineConfig([{ keep: 1, steps: { __proto__: { build: \'b\' } } }]);');

    expect(result.entries).toEqual([{ keep: 1, steps: OPAQUE }]);
    expect(result.opaque).toEqual([[['steps']]]);
  });

  test('makes an element with a top-level spread opaque at the root path, keeping its index', () => {
    // Arrange / Act
    const result = readOk('defineConfig([{ a: 1 }, { ...base, b: 2 }, { c: 3 }]);');

    // Assert
    expect(result.entries).toEqual([{ a: 1 }, OPAQUE, { c: 3 }]);
    expect(result.opaque).toEqual([[], [[]], []]);
    expect(result.elements).toHaveLength(3);
  });

  test('makes an array holding a spread opaque as a whole', () => {
    const result = readOk('defineConfig([{ list: [1, ...more] }]);');

    expect(result.entries).toEqual([{ list: OPAQUE }]);
    expect(result.opaque).toEqual([[['list']]]);
  });

  test('makes an array with a hole opaque as a whole', () => {
    const result = readOk('defineConfig([{ list: [1, , 2] }]);');

    expect(result.entries).toEqual([{ list: OPAQUE }]);
    expect(result.opaque).toEqual([[['list']]]);
  });
});

describe('readEntries: element nodes', () => {
  test('returns each element\'s ObjectExpression, unwrapped, in order', () => {
    // Arrange
    const source = `${IMPORT}defineConfig([{ a: 1 }, { b: 2 } satisfies object]);`;

    // Act
    const result = readEntries(program(source));

    // Assert
    if (result.kind !== 'entries') {
      throw new Error(`expected entries, got ${result.kind}`);
    }
    expect(result.elements.every((node) => node.type === 'ObjectExpression')).toBe(true);
    expect(result.elements.map((node) => source.slice(...node.range))).toEqual(['{ a: 1 }', '{ b: 2 }']);
  });

  test('returns the `defineConfig(` call with the entries', () => {
    const source = `${IMPORT}export default defineConfig([{ a: 1 }]);`;

    const result = readEntries(program(source));

    expect(result.kind).toBe('entries');
    expect(callText(source, result)).toBe('defineConfig([{ a: 1 }])');
  });
});

describe('readEntries: unsupported arrays', () => {
  test.each([
    ['an identifier element', 'defineConfig([{ a: 1 }, base]);'],
    ['a call element', 'defineConfig([make(), { a: 1 }]);'],
    ['a spread element', 'defineConfig([...base, { a: 1 }]);'],
    ['a hole', 'defineConfig([{ a: 1 }, , { b: 2 }]);'],
    ['an array element', 'defineConfig([[{ a: 1 }]]);'],
    ['a literal element', 'defineConfig([{ a: 1 }, null]);'],
    ['a conditional element', 'defineConfig([ok ? { a: 1 } : { a: 2 }]);'],
    ['a non-array argument', 'defineConfig(entries);'],
    ['a spread argument', 'defineConfig(...args);'],
    ['no argument', 'defineConfig();'],
  ])('reports %s as unsupported', (_name, body) => {
    // Arrange
    const source = `${IMPORT}${body}`;

    // Act
    const result = readEntries(program(source));

    // Assert
    expect(result.kind).toBe('unsupported');
    expect(callText(source, result)).toBe(body.slice(0, -1));
  });

  test('reports a non-literal element wrapped in `as` as unsupported', () => {
    expect(read('defineConfig([base as Entry]);').kind).toBe('unsupported');
  });
});

describe('readEntries: finding the call', () => {
  test('yields no entries for a file with no `defineConfig(` call', () => {
    expect(read('export default [{ a: 1 }];')).toEqual({ kind: 'none' });
  });

  test('yields no entries for a file with two `defineConfig(` calls', () => {
    expect(read('export const a = defineConfig([{ a: 1 }]);\nexport const b = defineConfig([{ b: 2 }]);')).toEqual({ kind: 'none' });
  });

  test('counts a call nested inside another expression', () => {
    const result = readOk('export default wrap(() => defineConfig([{ a: 1 }]));');

    expect(result.entries).toEqual([{ a: 1 }]);
  });

  test('ignores a `defineConfig` that is not imported from the library', () => {
    // Arrange: the control, the same call with the library import, reads entries.
    const call = 'defineConfig([{ a: 1 }]);';

    // Act / Assert
    expect(readEntries(program(`${IMPORT}${call}`)).kind).toBe('entries');
    expect(readEntries(program(call))).toEqual({ kind: 'none' });
    expect(readEntries(program(`import { defineConfig } from 'eslint/config';\n${call}`))).toEqual({ kind: 'none' });
    expect(readEntries(program(`import type { defineConfig } from '@open-tomato/define-config';\n${call}`))).toEqual({ kind: 'none' });
    expect(readEntries(program(`import { type defineConfig } from '@open-tomato/define-config';\n${call}`))).toEqual({ kind: 'none' });
  });

  test('finds the call through an aliased import, and not under the unaliased name', () => {
    // Arrange
    const header = 'import { defineConfig as config } from \'@open-tomato/define-config\';\n';

    // Act / Assert
    expect(readEntries(program(`${header}config([{ a: 1 }]);`)).kind).toBe('entries');
    expect(readEntries(program(`${header}defineConfig([{ a: 1 }]);`))).toEqual({ kind: 'none' });
  });

  test('ignores a member call such as `lib.defineConfig(…)`', () => {
    expect(read('lib.defineConfig([{ a: 1 }]);')).toEqual({ kind: 'none' });
  });

  test('reads the call with type arguments', () => {
    expect(readOk('defineConfig<Config, \'steps.build\'>([{ steps: { build: \'b\' } }]);').entries).toEqual([
      { steps: { build: 'b' } },
    ]);
  });
});
