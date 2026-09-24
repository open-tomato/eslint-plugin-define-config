# Testing notes for this tree

Facts about this repo's test suite that its gates do not state on their own. Each entry replaces
nothing written elsewhere; `AGENTS.md` points here from its test section.

## `check-types` is stricter than `bun test`

- `tsconfig.json` sets `lib: ["ES2022"]` and `check-types` covers `*.test.ts`, so an ES2023 method
  such as `Array.prototype.toSorted` passes `bun test` and fails `check-types`. Sort a copy with
  `[...items].sort()`.
- A literal array compared with `toEqual` against `DiagnosticCode` values infers `string[]` and
  fails with TS2769; annotate it as `DiagnosticCode[]`.

## The `RULES` exhaustiveness test type-checks a scratch copy

`src/rules/rules-exhaustive.test.ts` copies `src/`, `tsconfig.base.json` and `package.json` into
a temp directory and runs `tsc --noEmit` there. Anything else is absent from the copy, so a test
under `src/` must not statically import from `../fixtures/` (or any path outside that set): the
"unmodified copy of src type-checks" case goes red. Load fixture modules with a dynamic `import()`
of a computed path instead. A new file a `src/` test needs outside `src/` must be added to the copy.

## The host fixture

- The root `eslint .` ignores `fixtures/**`, so a plain run style-checks nothing there and passes
  vacuously. Run `bunx eslint --no-ignore fixtures/host`, and confirm with `-f json` that the
  files were actually linted.
- `eslint .` inside `fixtures/host/` also lints `defaults/rafa.config.ts` as a project file, merged
  behind itself as settings defaults. Its layers differ, so no `duplicate-key` appears, but any
  graph flaw in the defaults alone would be reported: keep the defaults layer clean on its own.
- `rollback` is a project-layer step reached only through `deploy.on.fail`. That is what makes the
  opaque variant's "no `unreachable`" assertion meaningful; if `rollback` becomes reachable another
  way, the assertion still passes but proves nothing.

## Opaque cases that do not prove suppression

In the per-rule `RuleTester` suites, the opaque cases for `required-dropped`, `cycle` and
`interactive-unattended` stay silent even with suppression removed: the placeholder string never
drops a required key, becomes an `unknown-step` rather than a cycle, and is not `true` for
`$unattended`. Only the other six rules' opaque cases go red without `src/analysis/suppress.ts`.
Treat those three as coverage debt, not as evidence the suppression works for them.
