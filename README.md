# eslint-plugin-define-config

ESLint plugin for validating config entries and schemas with `@open-tomato/define-config`.

## Install

```bash
npm install --save-dev @open-tomato/eslint-plugin-define-config
```

Requires ESLint ≥9 and `@open-tomato/define-config` ≥0.4.0.

## Usage

Add the plugin's `recommended` preset to your ESLint flat config, alongside settings that
describe your config files:

```ts
import defineConfigPlugin from '@open-tomato/eslint-plugin-define-config';

import defaults from './defaults/rafa.config';
import { steps } from './steps';

export default [
  defineConfigPlugin.configs.recommended,
  {
    settings: {
      'define-config': {
        defaults,
        steps,
      },
    },
  },
];
```

The plugin will report `@open-tomato/define-config` diagnostics on the config entries
that cause them. For example, a `duplicate-key` diagnostic surfaces at the line where a
key is set a second time within the same layer.

## Supported File Shape

The plugin reports on TypeScript files that export config entries built with
`@open-tomato/define-config`'s `defineConfig()` function:

```ts
// rafa.config.ts — config entries, one or more per file
import { defineConfig } from '@open-tomato/define-config';

export default defineConfig([
  { timeout: 30, flows: { /* ... */ } },
  { timeout: 60 },  // also checked for duplicates and validity
]);
```

Config files should:
- Use the `defineConfig()` wrapper for type safety and documentation
- Export a default value (recognized by ESLint's linting scope)
- Be discoverable by the loader's `lookup` glob pattern (commonly `rafa.config.ts` or
  `config.ts`)
- Contain object literals (the plugin performs static analysis; identifiers and
  expressions are not analyzed for their values)

## settings['define-config']

The plugin requires two settings keys:

### `defaults`

The default layer config entries: an array of configuration objects returned by
`defineConfig()`. These are merged first before any file-specific entries, and used to
establish the baseline for detecting duplicates and validating required keys.

```ts
import { defineConfig } from '@open-tomato/define-config';

const config = defineConfig([
  { timeout: 30, flows: { ship: { /* ... */ } } },
]);

export const defaults = config;
```

### `steps`

A `StepRegistry` object mapping step names to their declared outcomes. This is used to
validate that handlers in flows reference only declared outcomes and steps.

```ts
import type { StepRegistry } from '@open-tomato/define-config';

export const steps: StepRegistry = {
  build: { outcomes: ['success', 'fail'] },
  deploy: { outcomes: ['success'] },
};
```

Each step maps to an object with an `outcomes` array; handlers in flows must target only
outcomes that the step declares.

## Recommended Preset

The `recommended` preset enables all rules at their default severity levels. Include it in
your config:

```ts
import defineConfigPlugin from '@open-tomato/eslint-plugin-define-config';

export default [defineConfigPlugin.configs.recommended];
```

### Rule Levels

| Rule | Level | Description |
|------|-------|-------------|
| `define-config/settings` | error | Missing or malformed settings |
| `define-config/duplicate-key` | warn | A key set twice in the same layer |
| `define-config/required-dropped` | error | A required key was removed by an entry |
| `define-config/handler-conflict` | error | Two handlers target the same outcome |
| `define-config/unknown-step` | error | A handler targets a step not in the registry |
| `define-config/unknown-outcome` | error | A handler targets an outcome the step doesn't declare |
| `define-config/impure-when` | error | A `$when` condition is not pure (has side effects) |
| `define-config/cycle` | error | A handler creates a cycle in the flow graph |
| `define-config/interactive-unattended` | error | An interactive flow is marked unattended |
| `define-config/unreachable` | warn | A step is unreachable from the flow's start step |

You can override any rule's level in your config:

```ts
import defineConfigPlugin from '@open-tomato/eslint-plugin-define-config';

export default [
  defineConfigPlugin.configs.recommended,
  {
    rules: {
      'define-config/duplicate-key': 'error',
      'define-config/unreachable': 'off',
    },
  },
];
```

## What is Never Reported

The plugin does **not** report the following `@open-tomato/define-config` diagnostic codes:

- **`schema`** — Schema validation errors (e.g., invalid type for a field). These are
  caught by TypeScript's type checker when you import and use the config via
  `@open-tomato/define-config`'s `useConfig()`.
- **`load-failed`** — File I/O or parsing errors from the loader. These are issues with
  the config file's syntax or the loader's directory setup; ESLint already reports
  parser errors for TypeScript files.

Both of these are validation concerns that happen outside the merge and flow-graph phases
the ESLint plugin analyzes.
