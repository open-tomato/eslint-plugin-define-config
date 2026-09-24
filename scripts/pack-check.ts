/**
 * Dry-run pack validator: asserts the published tarball would hold the
 * build entry points, that it holds nothing but `package.json`,
 * `README.md`, `LICENSE` and files under `dist/`, and that the manifest's
 * `dependencies` is exactly `@open-tomato/define-config` at a registry
 * semver range.
 *
 * Run as `bun run check-pack`.
 */

/** Files that must appear in the tarball. */
export const REQUIRED_FILES: readonly string[] = [
  'package.json',
  'dist/index.js',
  'dist/index.d.ts',
];

/** Tarball paths allowed by name; every path under `dist/` is also allowed. */
export const ALLOWED_FILES: readonly string[] = [
  'package.json',
  'README.md',
  'LICENSE',
];

/** The one runtime dependency the manifest may, and must, declare. */
export const RUNTIME_DEPENDENCY = '@open-tomato/define-config';

/**
 * Extracts file paths from `bun pm pack --dry-run` output lines of the form
 * `packed <size> <path>`.
 *
 * @param output - Combined stdout/stderr of the pack command.
 * @returns The listed file paths, in output order.
 */
export function parsePackedFiles(output: string): string[] {
  return output
    .split('\n')
    .map((line) => /^packed\s+\S+\s+(.+?)\s*$/.exec(line)?.[1])
    .filter((path): path is string => path !== undefined);
}

/**
 * Reports each required file missing from the packed file list.
 *
 * @param files - Paths listed by the dry-run pack.
 * @returns One message per missing file; empty when all are present.
 */
export function checkPackedFiles(files: readonly string[]): string[] {
  return REQUIRED_FILES
    .filter((required) => !files.includes(required))
    .map((required) => `packed tarball is missing ${required}`);
}

/**
 * Reports each packed path outside the allow-list: the
 * {@link ALLOWED_FILES} names plus any path under `dist/`.
 *
 * @param files - Paths listed by the dry-run pack.
 * @returns One message per disallowed path; empty when all are allowed.
 */
export function checkAllowList(files: readonly string[]): string[] {
  return files
    .filter((file) => !ALLOWED_FILES.includes(file) && !file.startsWith('dist/'))
    .map((file) => `packed tarball holds ${file}, which is outside the allow-list`);
}

const PARTIAL = '(?:0|[1-9]\\d*|[xX*])';
const PRERELEASE = '(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?';
const BUILD = '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?';
const VERSION = `v?${PARTIAL}(?:\\.${PARTIAL}(?:\\.${PARTIAL}${PRERELEASE}${BUILD})?)?`;
const COMPARATOR = new RegExp(`^(?:<=?|>=?|=|~|\\^)?${VERSION}$`);
const HYPHEN_RANGE = new RegExp(`^${VERSION} - ${VERSION}$`);

/**
 * Tells whether a dependency specifier is a semver range in npm's range
 * grammar: `||`-joined sets, each a hyphen range or whitespace-separated
 * comparators such as `^0.4.0`, `>=1.2 <2` or `1.x`. Protocol specifiers
 * (`file:`, `link:`, `workspace:`, `npm:`, git URLs), paths and dist-tags
 * are not ranges.
 *
 * @param specifier - The value of a `dependencies` entry.
 * @returns `true` when the specifier is a semver range.
 */
export function isSemverRange(specifier: string): boolean {
  if (specifier.trim() === '') {
    return false;
  }
  return specifier.split('||').every((set) => {
    const trimmed = set.trim().replace(/\s+/g, ' ');
    if (HYPHEN_RANGE.test(trimmed)) {
      return true;
    }
    return trimmed !== ''
      && trimmed.split(' ').every((comparator) => COMPARATOR.test(comparator));
  });
}

const LOCAL_PROTOCOLS: readonly string[] = ['file:', 'link:', 'workspace:'];

/**
 * Reports a manifest whose `dependencies` is not exactly
 * {@link RUNTIME_DEPENDENCY} at a semver range: a missing or non-object
 * field, any other key, a `file:`, `link:` or `workspace:` specifier, or
 * any other value that {@link isSemverRange} rejects.
 *
 * @param manifest - Parsed package.json contents.
 * @returns Problem messages; empty when the manifest is clean.
 */
export function checkManifest(manifest: unknown): string[] {
  if (typeof manifest !== 'object' || manifest === null) {
    return ['manifest is not a JSON object'];
  }
  const dependencies: unknown = (manifest as Record<string, unknown>)['dependencies'];
  if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) {
    return [`manifest must carry a "dependencies" object holding only ${RUNTIME_DEPENDENCY}`];
  }
  const entries = Object.entries(dependencies as Record<string, unknown>);
  const extras = entries
    .filter(([name]) => name !== RUNTIME_DEPENDENCY)
    .map(([name]) => `manifest "dependencies" must not carry ${name}`);
  const specifier = entries.find(([name]) => name === RUNTIME_DEPENDENCY)?.[1];
  return [...extras, ...checkSpecifier(specifier)];
}

function checkSpecifier(specifier: unknown): string[] {
  if (specifier === undefined) {
    return [`manifest "dependencies" is missing ${RUNTIME_DEPENDENCY}`];
  }
  if (typeof specifier !== 'string') {
    return [`${RUNTIME_DEPENDENCY} specifier is not a string`];
  }
  const protocol = LOCAL_PROTOCOLS.find((prefix) => specifier.startsWith(prefix));
  if (protocol !== undefined) {
    return [`${RUNTIME_DEPENDENCY} uses a ${protocol} specifier (${specifier}); use a registry semver range`];
  }
  if (!isSemverRange(specifier)) {
    return [`${RUNTIME_DEPENDENCY} specifier ${specifier} is not a semver range`];
  }
  return [];
}

async function main(): Promise<number> {
  const proc = Bun.spawn(['bun', 'pm', 'pack', '--dry-run'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    console.error(`bun pm pack --dry-run exited ${exitCode}\n${stderr}`);
    return 1;
  }
  const manifest: unknown = await Bun.file('package.json').json();
  const packed = parsePackedFiles(`${stdout}\n${stderr}`);
  const problems = [
    ...checkPackedFiles(packed),
    ...checkAllowList(packed),
    ...checkManifest(manifest),
  ];
  for (const problem of problems) {
    console.error(`check-pack: ${problem}`);
  }
  if (problems.length === 0) {
    console.log('check-pack: ok');
  }
  return Number(problems.length > 0);
}

if (import.meta.main) {
  process.exit(await main());
}
