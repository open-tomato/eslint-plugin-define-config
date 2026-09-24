/**
 * The host's step registry, as a host package would export it for its
 * loader and for `settings['define-config'].steps`.
 *
 * `deploy` declares only `success`, so a handler for `fail` on it is an
 * `unknown-outcome`.
 */
import type { StepRegistry } from '@open-tomato/define-config';

/** Every step the fixture's flows may run, with the outcomes it declares. */
export const steps: StepRegistry = {
  build: { outcomes: ['success', 'fail'] },
  deploy: { outcomes: ['success'] },
  rollback: { outcomes: ['done'] },
};

/**
 * A step id held in a variable. `opaque/rafa.config.ts` writes a handler
 * as `on: { fail: target }`, which the plugin cannot read statically.
 */
export const target = 'rollback';
