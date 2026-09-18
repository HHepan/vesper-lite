import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    root: __dirname,
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 10000,
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        target: 'ES2024',
        module: 'Node16',
      }
    }
  }
});
