import type { PluginSettings, SettingsResult } from './settings';

import { merge, resolveGraph } from '@open-tomato/define-config';
import { describe, expect, test } from 'bun:test';

import { DEFAULT_DUPLICATES, readSettings, SETTINGS_KEY } from './settings';

/** Read `value` placed under the plugin's settings key. */
const readUnder = (value: unknown): SettingsResult => readSettings({ [SETTINGS_KEY]: value });

/** Read `value` under the key and fail the test unless it is well formed. */
const readOk = (value: unknown): PluginSettings => {
  const result = readUnder(value);
  if (result.kind !== 'ok') {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  return result.settings;
};

/** Read `value` under the key and return its problems, or fail the test. */
const problemsOf = (value: unknown): readonly string[] => {
  const result = readUnder(value);
  if (result.kind !== 'malformed') {
    throw new Error(`expected malformed, got ${JSON.stringify(result)}`);
  }
  return result.problems;
};

describe('readSettings: absent', () => {
  test('reports absent when the shared settings have no plugin key', () => {
    // Arrange
    const shared = { other: { steps: {} } };

    // Act
    const result = readSettings(shared);

    // Assert
    expect(result).toEqual({ kind: 'absent' });
  });

  test('reports absent when the shared settings are not an object', () => {
    // Arrange
    const inputs: unknown[] = [undefined, null, 'define-config', 1];

    // Act
    const results = inputs.map(readSettings);

    // Assert
    expect(results).toEqual(inputs.map(() => ({ kind: 'absent' })));
  });

  test('reads the key as written, not a near miss such as defineConfig', () => {
    // Arrange
    const shared = { defineConfig: { steps: {} } };

    // Act
    const result = readSettings(shared);

    // Assert
    expect(result.kind).toBe('absent');
  });
});

describe('readSettings: well formed', () => {
  test('fills every default for an empty object', () => {
    // Arrange
    const raw = {};

    // Act
    const settings = readOk(raw);

    // Assert
    expect(settings).toEqual({ defaults: [], required: [], duplicates: DEFAULT_DUPLICATES });
    expect('steps' in settings).toBe(false);
    expect(DEFAULT_DUPLICATES).toBe('warn');
  });

  test('keeps every field the host gives', () => {
    // Arrange
    const steps = {
      lint: { outcomes: ['success', 'fail'], required: true, pure: true },
      ask: { outcomes: ['yes', 'no'], interactive: false },
    };
    const raw = {
      defaults: [{ $layer: 'global', a: { x: 1 } }, { b: 2 }],
      steps,
      required: ['a.x', 'b'],
      duplicates: 'error',
    };

    // Act
    const settings = readOk(raw);

    // Assert
    expect(settings).toEqual({
      defaults: [{ $layer: 'global', a: { x: 1 } }, { b: 2 }],
      steps,
      required: ['a.x', 'b'],
      duplicates: 'error',
    });
  });

  test('accepts each duplicates value and a null-prototype object', () => {
    // Arrange
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { duplicates: 'allow' });

    // Act
    const values = ['warn', 'error', 'allow'].map((duplicates) => readOk({ duplicates }).duplicates);
    const fromBare = readOk(bare).duplicates;

    // Assert
    expect(values).toEqual(['warn', 'error', 'allow']);
    expect(fromBare).toBe('allow');
  });

  test('copies the arrays, so a later change to the host arrays does not reach the settings', () => {
    // Arrange
    const defaults: Record<string, unknown>[] = [{ a: 1 }];
    const required = ['a'];
    const settings = readOk({ defaults, required });

    // Act
    defaults.push({ b: 2 });
    required.push('b');

    // Assert
    expect(settings.defaults).toEqual([{ a: 1 }]);
    expect(settings.required).toEqual(['a']);
  });

  test('yields options merge and resolveGraph accept', () => {
    // Arrange
    const settings = readOk({
      defaults: [{ $layer: 'global', flows: { main: { lint: { on: { success: 'lint' } } } } }],
      steps: { lint: { outcomes: ['success'] } },
      required: ['flows.main'],
      duplicates: 'error',
    });

    // Act
    const merged = merge(settings.defaults, { required: settings.required, duplicates: settings.duplicates });
    const resolved = resolveGraph(merged.value['flows'] as Parameters<typeof resolveGraph>[0], settings.steps ?? {});

    // Assert
    expect(merged.diagnostics).toEqual([]);
    expect(Object.keys(resolved.graph.nodes)).toHaveLength(1);
  });
});

describe('readSettings: malformed', () => {
  test('reports a value under the key that is not a plain object', () => {
    // Arrange
    const inputs: unknown[] = [null, [], 'x', new Map()];

    // Act
    const problems = inputs.map(problemsOf);

    // Assert
    expect(problems).toEqual([
      ['define-config: expected an object, got null'],
      ['define-config: expected an object, got array'],
      ['define-config: expected an object, got string'],
      ['define-config: expected an object, got object'],
    ]);
  });

  test('reports defaults that are not an array of plain objects', () => {
    // Arrange
    const raws = [
      { defaults: { a: 1 } },
      { defaults: [{ a: 1 }, [], null, { $layer: 3 }] },
    ];

    // Act
    const problems = raws.map(problemsOf);

    // Assert
    expect(problems).toEqual([
      ['defaults: expected an array of plain objects, got object'],
      [
        'defaults[1]: expected a plain object, got array',
        'defaults[2]: expected a plain object, got null',
        'defaults[3].$layer: expected a string, got number',
      ],
    ]);
  });

  test('reports a steps registry with a wrong shape at each level', () => {
    // Arrange
    const raws = [
      { steps: ['lint'] },
      {
        steps: {
          a: 'lint',
          b: {},
          c: { outcomes: ['ok', 1] },
          d: { outcomes: [], pure: 'yes', required: 1, interactive: null },
        },
      },
    ];

    // Act
    const problems = raws.map(problemsOf);

    // Assert
    expect(problems).toEqual([
      ['steps: expected a step registry object, got array'],
      [
        'steps.a: expected { outcomes, required?, pure?, interactive? }, got string',
        'steps.b.outcomes: expected an array of strings, got undefined',
        'steps.c.outcomes[1]: expected a string, got number',
        'steps.d.required: expected a boolean, got number',
        'steps.d.pure: expected a boolean, got string',
        'steps.d.interactive: expected a boolean, got null',
      ],
    ]);
  });

  test('reports required paths merge would refuse', () => {
    // Arrange
    const raws = [
      { required: 'a.x' },
      { required: ['a.x', 2, 'a..x', ''] },
    ];

    // Act
    const problems = raws.map(problemsOf);

    // Assert
    expect(problems).toEqual([
      ['required: expected an array of dot-joined paths, got string'],
      [
        'required[1]: expected a dot-joined path, got number',
        'required[2]: "a..x" has an empty key',
        'required[3]: "" has an empty key',
      ],
    ]);
  });

  test('reports a duplicates value outside warn, error and allow', () => {
    // Arrange
    const raws = [{ duplicates: 'loud' }, { duplicates: true }, { duplicates: null }];

    // Act
    const problems = raws.map(problemsOf);

    // Assert
    expect(problems).toEqual([
      ['duplicates: expected \'warn\', \'error\' or \'allow\', got "loud"'],
      ['duplicates: expected \'warn\', \'error\' or \'allow\', got true'],
      ['duplicates: expected \'warn\', \'error\' or \'allow\', got null'],
    ]);
  });

  test('reports an unknown key such as a misspelt step', () => {
    // Arrange
    const raw = { step: { lint: { outcomes: [] } } };

    // Act
    const problems = problemsOf(raw);

    // Assert
    expect(problems).toEqual(['step: unknown key; expected one of defaults, steps, required, duplicates']);
  });

  test('lists every problem across fields in field order', () => {
    // Arrange
    const raw = { extra: 1, duplicates: 'x', required: [1], steps: 2, defaults: 3 };

    // Act
    const problems = problemsOf(raw);

    // Assert
    expect(problems.map((problem) => problem.split(/[.:[]/u)[0])).toEqual(['defaults', 'steps', 'required', 'duplicates', 'extra']);
  });

  test('refuses exactly the defaults, required and duplicates values that make merge throw', () => {
    // Arrange
    const refused = [
      { defaults: [[]] },
      { defaults: [{ $layer: 3 }] },
      { required: [2] },
      { required: ['a..x'] },
      { duplicates: 'loud' },
    ];
    const run = (raw: Record<string, unknown>) => () => merge(
      (raw['defaults'] as unknown[] | undefined) ?? [],
      { required: raw['required'] as string[] | undefined, duplicates: raw['duplicates'] as 'warn' | undefined },
    );

    // Act
    const kinds = refused.map((raw) => readUnder(raw).kind);

    // Assert
    expect(kinds).toEqual(refused.map(() => 'malformed'));
    for (const raw of refused) {
      expect(run(raw)).toThrow(TypeError);
    }
  });
});
