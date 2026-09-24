import { describe, expect, test } from 'bun:test';

import {
  checkAllowList,
  checkManifest,
  checkPackedFiles,
  isSemverRange,
  parsePackedFiles,
} from './pack-check';

const PACK_OUTPUT = [
  'packed 1.96KB package.json',
  'packed 11B dist/index.d.ts',
  'packed 82B dist/index.js',
].join('\n');

describe('parsePackedFiles', () => {
  test('extracts file paths from packed lines', () => {
    // Arrange / Act
    const files = parsePackedFiles(`bun pack v1.3.14\n${PACK_OUTPUT}\nTotal files: 3`);

    // Assert
    expect(files).toEqual(['package.json', 'dist/index.d.ts', 'dist/index.js']);
  });

  test('returns an empty list for empty output', () => {
    expect(parsePackedFiles('')).toEqual([]);
  });
});

describe('checkPackedFiles', () => {
  test('reports no problems when all required files are listed', () => {
    expect(checkPackedFiles(parsePackedFiles(PACK_OUTPUT))).toEqual([]);
  });

  test('reports each missing required file', () => {
    // Arrange
    const files = ['package.json', 'README.md'];

    // Act
    const problems = checkPackedFiles(files);

    // Assert
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain('dist/index.js');
    expect(problems.join('\n')).toContain('dist/index.d.ts');
  });
});

const CLEAN_LISTING = [
  'package.json',
  'README.md',
  'LICENSE',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/rules/duplicate-key.d.ts',
];

describe('checkAllowList', () => {
  test('reports no problems for a clean listing', () => {
    expect(checkAllowList(CLEAN_LISTING)).toEqual([]);
  });

  test.each([
    'CHANGELOG.md',
    'NOTICE',
    'src/index.ts',
    'scripts/pack-check.ts',
    'fixtures/host/package.json',
    'distribution/index.js',
  ])('reports %s as outside the allow-list', (stray) => {
    // Arrange / Act
    const problems = checkAllowList([...CLEAN_LISTING, stray]);

    // Assert
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(stray);
  });

  test('reports every stray path in one pass', () => {
    // Arrange
    const strays = ['src/index.ts', 'AGENTS.md', 'planted.txt'];

    // Act
    const problems = checkAllowList([...CLEAN_LISTING, ...strays]);

    // Assert
    expect(problems).toHaveLength(3);
  });
});

describe('isSemverRange', () => {
  test.each([
    '^0.4.0',
    '~0.4.1',
    '0.4.0',
    '>=0.4.0 <0.5.0',
    '0.4.x',
    '*',
    '^1.0.0-rc.1',
    '0.4.0 - 0.5.0',
    '^0.4.0 || ^1.0.0',
  ])('accepts %s', (range) => {
    expect(isSemverRange(range)).toBe(true);
  });

  test.each([
    '',
    'latest',
    'file:../define-config',
    'link:../define-config',
    'workspace:^',
    'npm:@open-tomato/define-config@^0.4.0',
    'github:open-tomato/define-config',
    '../define-config',
    '^0.4.0 ||',
  ])('rejects %p', (specifier) => {
    expect(isSemverRange(specifier)).toBe(false);
  });
});

function manifestWith(dependencies: unknown): Record<string, unknown> {
  return { name: '@open-tomato/eslint-plugin-define-config', dependencies };
}

describe('checkManifest', () => {
  test('accepts the repository manifest', async () => {
    // Arrange
    const manifest: unknown = await Bun.file('package.json').json();

    // Act / Assert
    expect(checkManifest(manifest)).toEqual([]);
  });

  test('accepts the dependency at a semver range', () => {
    expect(checkManifest(manifestWith({ '@open-tomato/define-config': '^0.4.0' }))).toEqual([]);
  });

  test.each(['file:../define-config', 'link:../define-config', 'workspace:^'])(
    'rejects the %s specifier by its protocol',
    (specifier) => {
      // Arrange
      const manifest = manifestWith({ '@open-tomato/define-config': specifier });

      // Act
      const problems = checkManifest(manifest);

      // Assert
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(specifier.slice(0, specifier.indexOf(':') + 1));
    },
  );

  test('rejects a specifier that is not a semver range', () => {
    // Arrange / Act
    const problems = checkManifest(manifestWith({ '@open-tomato/define-config': 'latest' }));

    // Assert
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not a semver range');
  });

  test('rejects a second dependency', () => {
    // Arrange
    const manifest = manifestWith({
      '@open-tomato/define-config': '^0.4.0',
      'lodash': '^4.17.21',
    });

    // Act
    const problems = checkManifest(manifest);

    // Assert
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('lodash');
  });

  test('rejects dependencies without the runtime dependency', () => {
    // Arrange / Act
    const problems = checkManifest(manifestWith({}));

    // Assert
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('missing @open-tomato/define-config');
  });

  test('rejects a manifest with no dependencies field', () => {
    expect(checkManifest({ name: 'x' })).toHaveLength(1);
  });

  test('rejects a non-string specifier', () => {
    expect(checkManifest(manifestWith({ '@open-tomato/define-config': 4 }))).toHaveLength(1);
  });

  test('rejects a manifest that is not an object', () => {
    expect(checkManifest(null)).toHaveLength(1);
  });
});
