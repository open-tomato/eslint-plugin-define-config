# @open-tomato/eslint-plugin-define-config — Agent Instructions

This is a **single-package ESLint plugin** for validating config entries and schemas with
`@open-tomato/define-config`. Dependency-light (one runtime dependency, eslint peer), fully typed,
published to npmjs.

**Version:** 0.1.0 · **Language:** TypeScript · **Runtime:** Bun

## Package Layout

```text
src/
├── <area>/
│   ├── <module>.ts          # Exported module with TSDoc
│   └── <module>.test.ts     # Colocated unit tests (bun test)
index.ts                      # Main entry point (re-exports all rules)

dist/
├── index.js                  # ESM output (built)
├── index.d.ts                # TypeScript declarations

test outputs:
├── .bun/                     # Bun runtime cache
└── node_modules/             # Gitignored dev dependencies
```

Files stay under 800 lines; split before a file nears the cap. All exported symbols carry TSDoc
(function signatures, interface fields, type descriptions).

## Five Gates (Verification)

All gates must pass before reporting done. Run each explicitly and read its exit code and summary
line; never grep a capture for "fail":

```sh
# 1. Lint: ESLint style enforcement (single quotes, semicolons, 2-space indent,
#    trailing commas, import type first, alphabetized import groups)
bun run lint

# 2. Check Types: TypeScript strict mode (includes *.test.ts files for assertion
#    type precision)
bun run check-types

# 3. Test: Bun test runner (AAA pattern: Arrange, Act, Assert)
bun test

# 4. Build: ESM bundle + declarations (outputs to dist/)
bun run build

# 5. Check Pack: Verify published package contents and dependencies
bun run check-pack
```

**Gate behavior notes:**
- `bun run lint` runs ESLint over `src/`, `scripts/`, and root-level files. Ignores `dist/`,
  `node_modules/`, `.claude/`, `.rafa/`, and `fixtures/`. `.md` files get `markdown/recommended`
  over their Markdown structure. Lint parses and style-checks README examples but does not type-check
  them.
- `bun run check-types` includes test files; `@ts-expect-error` in a test is a real type assertion.
- `bun test` discovers and runs `**/*.test.ts` files in parallel, excluding those under `fixtures/`.
- `bun run build` removes `dist/`, bundles to ESM with dependencies external, and emits TypeScript
  declarations. `tsconfig.build.json` excludes `src/**/*.test.ts` and `src/**/fixtures/**`.
- `bun run check-pack` asserts the required files are in the pack, that the pack holds nothing
  outside the allow-list (`package.json`, `README.md`, `LICENSE` and `dist/**`), and that
  `dependencies` contains exactly `@open-tomato/define-config` at a semver range with no `file:`,
  `link:` or `workspace:` specifier.

**The host fixture is not a gate.** `bun run lint:fixture` runs `bun --bun eslint .` inside
`fixtures/host/`, whose `eslint.config.mjs` imports the plugin from `../../src/index.ts` (no build
needed). Its `rafa.config.ts` is broken on purpose, so the script reports one
`define-config/unknown-outcome` error and one `define-config/duplicate-key` warning there, plus the
same warning in `opaque/rafa.config.ts`, and exits 1.

## ESLint Style Law for Agent Sessions

**Style is enforced by ESLint.** Write code, run `bun run lint`, and take the ordering and fixes
from the message. The config is in `eslint.config.mjs` and `sharedRules.mjs` (adapted from
`../define-config`).

### Style Rules Summary

| Rule | Value | Purpose |
|------|-------|---------|
| Quotes | single | String literals use single quotes |
| Semicolons | always | Every statement ends with `;` |
| Indent | 2 spaces | 1 indent level = 2 spaces; switch cases +1 |
| Trailing commas | always-multiline | Multiline objects/arrays end with `,` |
| Line breaks | 1 max between statements | No blank line runs; 1 blank at EOF |
| Import order | type, builtin, external, internal, parent, sibling, index | Groups alphabetized, newlines between groups |
| Arrow functions | beside | Implicit returns on same line as `=>` |
| Chained calls | newline per call (depth ≥ 3) | Long chains split; 2-deep chains stay on one line |
| Tabs | never | Spaces only |
| `var` | never | Use `let` or `const` |

**No `console.log` in production code.** Tests may use it; linting does not block it there.

## Reserved Keys in Config Objects

The `@open-tomato/define-config` library recognizes these keys with special semantics:

### Merge-time keys
- **`$replace: true`** — Inside a keyed map, replaces that entire subtree with the new value.
- **`<key>: false`** — At a map entry, marks that key for removal.
- **`$layer`** — On a top-level entry, labels its layer (for duplicate detection).

### Flow-time keys (in step graphs)
- **`$start`** — Names the entry step (the first step a flow executes).
- **`$unattended: true`** — On a flow root, marks it as unattended (default is attended).

## Test Coverage & TDD

Minimum coverage: **80%**. Use Bun's test runner with the AAA (Arrange-Act-Assert) pattern:

```ts
import { test, expect } from 'bun:test';

test('rule detects invalid config entry', () => {
  // Arrange
  const sourceCode = 'const x = { $replace: false };';

  // Act: typically involves running rule checks against source code
  // const results = ruleTester.run(sourceCode);

  // Assert
  expect(sourceCode).toContain('$replace');
});
```

Write tests first (RED), implement to pass (GREEN), refactor (IMPROVE), verify coverage. Use
`fast-check` for property-based testing where appropriate.

## Publishing

- **Registry:** npmjs (https://registry.npmjs.org/)
- **Scope:** `@open-tomato`
- **Access:** public
- **Runtime dependencies:** exactly `@open-tomato/define-config` at a semver range, no `file:`,
  `link:` or `workspace:` specifiers
- **Peer dependency:** `eslint >=9`
- **Package entrypoint:** `./dist/index.js`
- **Types:** `./dist/index.d.ts`
- **Files included:** `package.json`, `README.md`, `LICENSE`, and `dist/**`

## Agent Integration

**Agents to use proactively:**
- **tdd-guide** — New features or bug fixes (write tests first)
- **code-reviewer** — After writing code (check quality, security, patterns)
- **security-reviewer** — Before commits (validate no hardcoded secrets, input validation)
- **build-error-resolver** — When `bun run build` or `bun run check-types` fails

**Agent-harness prose** — `.claude/agents/` and `.claude/skills/` are not lint targets; they are
vendored from the umbrella and named here for reference.
