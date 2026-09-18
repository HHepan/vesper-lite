import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@vesper/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  test: {
    root: __dirname,
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 10000,
  },
});
