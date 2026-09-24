/**
 * The defaults layer: the host's own entries, read by the loader as its
 * first layer and passed to the plugin as `settings['define-config']
 * .defaults`. It is clean on its own: every step it names is registered
 * and reachable from `$start`.
 */
import { defineConfig } from '@open-tomato/define-config';

export default defineConfig([
  {
    timeout: 30,
    flows: {
      ship: {
        $start: 'build',
        build: { on: { success: 'deploy' } },
        deploy: {},
      },
    },
  },
]);
