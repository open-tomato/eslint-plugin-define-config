import { defineConfig } from '@open-tomato/define-config';

export default defineConfig([
  {
    flows: {
      build: {
        $start: 'compile',
        $unattended: true,
        steps: { compile: { handler: 'shell', run: 'bun run build', on: { ok: 'test', fail: null } } },
      },
    },
    handlers: { shell: { timeout: -1, retries: 3, tags: ['a', 'b'] } },
  },
  {
    flows: { build: { $replace: true, $start: 'lint', steps: { lint: { handler: 'shell' } } } },
    handlers: { shell: { retries: false } },
  },
]);
