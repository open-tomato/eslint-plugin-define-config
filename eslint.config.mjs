import baseConfig from '@open-tomato/eslint-config';
import markdownFencesConfig from '@open-tomato/eslint-config/markdown-fences';

/**
 * ESLint flat config: the shared open-tomato base and its Markdown-fences
 * flavor, plus what is this plugin's own. `fixtures/`, the directory
 * reserved for the host fixture, is left out.
 *
 * @type {import("eslint").Linter.Config[]} */
export default [
  {
    // Reserved for the host fixture, which the root `eslint .` does not
    // lint: its `rafa.config.ts` is broken on purpose.
    ignores: ['fixtures/**'],
  },
  ...baseConfig,
  ...markdownFencesConfig,
  {
    // The package's own name resolves to `dist/` only after a build, and
    // CI lints before it builds.
    files: ['**/*.md/*.ts', '**/*.md/*.js'],
    rules: {
      'import/no-unresolved': [
        'error',
        { ignore: ['^bun:', '^\\.\\.?/', '^@open-tomato/eslint-plugin-define-config$'] },
      ],
    },
    settings: {
      // Pin the package's own name to internal, so the order of a block's
      // imports does not depend on whether a build has run.
      'import/internal-regex': '^@open-tomato/eslint-plugin-define-config$',
    },
  },
];
