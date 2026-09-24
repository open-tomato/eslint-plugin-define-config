# CLAUDE.md

This file provides guidance to Claude Code when working with this ESLint plugin.

## Project Overview

`@open-tomato/eslint-plugin-define-config` is a TypeScript ESLint plugin that validates config
entries and schemas with the `@open-tomato/define-config` library. It is published to npmjs as a
public package under the `@open-tomato` scope.

## Key Guidance

- **Five gates must all pass:** lint, check-types, test, build, and check-pack.
- **Test-driven development:** Write tests first (AAA pattern), then implementation.
- **Minimum 80% test coverage:** Use Bun's test runner.
- **Style enforcement:** ESLint runs on all code; run `bun run lint` and take its fixes.
- **No runtime dependencies besides `@open-tomato/define-config`:** Peer dependency is `eslint >=9`.
- **Files stay under 800 lines:** Split into multiple modules before a file nears the cap.
- **All exports carry TSDoc:** Functions, types, interfaces, and their fields.

## Pre-commit Checklist

Before marking work done:
- [ ] All five gates pass: `bun run lint`, `bun run check-types`, `bun test`, `bun run build`, `bun run check-pack`
- [ ] Test coverage is 80%+
- [ ] No hardcoded secrets or credentials
- [ ] No `console.log` in production code
- [ ] All exports have TSDoc
- [ ] No files exceed 800 lines

## When to Use Agents

- **tdd-guide:** New features or bug fixes — write tests first
- **code-reviewer:** After writing code — check quality and patterns
- **security-reviewer:** Before commits — validate inputs and secrets
- **build-error-resolver:** When `bun run build` or `bun run check-types` fails

---

@AGENTS.md
