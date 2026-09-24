/**
 * The project layer, broken on purpose: `timeout` is set by two entries
 * of this one layer (`duplicate-key`), and `deploy` gets a handler for
 * `fail`, an outcome the `deploy` step does not declare
 * (`unknown-outcome`). `rollback` is reached only through that handler.
 */
import { defineConfig } from '@open-tomato/define-config';

export default defineConfig([
  { timeout: 60 },
  {
    flows: {
      ship: {
        deploy: { on: { fail: 'rollback' } },
        rollback: {},
      },
    },
  },
  { timeout: 90 },
]);
