import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const ROOT = resolve(import.meta.dir, '../..');
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const CYCLE_ROW = /^ {2}'cycle': \{\n[\s\S]*?^ {2}\},\n/m;

let scratch = '';

/** Runs `tsc --noEmit` over a scratch copy and returns its exit code. */
async function typecheck(dir: string): Promise<number> {
  const proc = Bun.spawn([process.execPath, TSC, '--noEmit', '-p', join(dir, 'tsconfig.json')], {
    cwd: dir,
    stdout: 'ignore',
    stderr: 'ignore',
  });

  return proc.exited;
}

/** Copies `src/` and the tsconfig files into a fresh scratch directory. */
async function makeCopy(name: string): Promise<string> {
  const dir = join(scratch, name);

  await cp(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  await cp(join(ROOT, 'tsconfig.base.json'), join(dir, 'tsconfig.base.json'));
  await cp(join(ROOT, 'package.json'), join(dir, 'package.json'));
  await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({
    extends: './tsconfig.base.json',
    compilerOptions: { lib: ['ES2022'], module: 'ESNext', types: ['bun'] },
    include: ['src'],
  }));
  await symlink(join(ROOT, 'node_modules'), join(dir, 'node_modules'));

  return dir;
}

describe('RULES exhaustiveness', () => {
  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'rules-exhaustive-'));
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  test('unmodified copy of src type-checks', async () => {
    // Arrange
    const dir = await makeCopy('intact');

    // Act
    const code = await typecheck(dir);

    // Assert
    expect(code).toBe(0);
  }, 60_000);

  test('copy with a RULES row deleted fails type-checking', async () => {
    // Arrange
    const dir = await makeCopy('missing-row');
    const file = join(dir, 'src', 'rules', 'rules.ts');
    const source = await readFile(file, 'utf8');

    expect(CYCLE_ROW.test(source)).toBe(true);
    await writeFile(file, source.replace(CYCLE_ROW, ''));

    // Act
    const code = await typecheck(dir);

    // Assert
    expect(code).not.toBe(0);
  }, 60_000);
});
