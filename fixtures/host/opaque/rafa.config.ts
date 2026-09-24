/**
 * The project layer with its handler written `on: { fail: target }`,
 * `target` an imported identifier. The plugin cannot know the handler's
 * target, so it reports nothing for flow `ship`: no `unknown-outcome`,
 * and no `unreachable` for `rollback`, which only that handler reaches.
 * The repeated `timeout` does not depend on the opaque value and is still
 * reported.
 */
import { defineConfig } from '@open-tomato/define-config';

import { target } from '../steps';

export default defineConfig([
  { timeout: 60 },
  {
    flows: {
      ship: {
        deploy: { on: { fail: target } },
        rollback: {},
      },
    },
  },
  { timeout: 90 },
]);
