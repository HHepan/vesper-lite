// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite — esbuild bundle script
// Produces standalone, zero-native-addon bundles in root dist/
// ═══════════════════════════════════════════════════════════════════════════

import * as esbuild from 'esbuild';
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Strip shebangs from source files so they don't duplicate the banner shebang
const stripShebangPlugin = {
  name: 'strip-shebang',
  setup(build) {
    build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
      const { readFile } = await import('node:fs/promises');
      let contents = await readFile(args.path, 'utf8');
      if (contents.startsWith('#!')) {
        contents = contents.replace(/^#![^\n]*\n/, '');
      }
      const loader = args.path.endsWith('.tsx') ? 'tsx' : 'ts';
      return { contents, loader };
    });
  },
};

// Stub optional dependencies that Ink tries to import
const stubOptionalPlugin = {
  name: 'stub-optional',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'react-devtools-core',
      namespace: 'stub-optional',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub-optional' }, () => ({
      contents: 'export default undefined;',
      loader: 'js',
    }));
  },
};

const esmCjsBanner = [
  '#!/usr/bin/env node',
  'import { createRequire as __lux_createRequire } from "node:module";',
  'import { fileURLToPath as __lux_fileURLToPath } from "node:url";',
  'import { dirname as __lux_dirname } from "node:path";',
  'const __filename = __lux_fileURLToPath(import.meta.url);',
  'const __dirname = __lux_dirname(__filename);',
  'const require = __lux_createRequire(import.meta.url);',
].join('\n');

const rootPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const buildDefine = {
  __VESPER_VERSION__:    JSON.stringify(rootPkg.version),
  __VESPER_BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
};

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  treeShaking: true,
  minify: true,
  sourcemap: false,
  plugins: [stripShebangPlugin, stubOptionalPlugin],
  define: buildDefine,
  external: ['node:*'],
  alias: {
    '@vesper/shared': resolve(root, 'packages/shared/src/index.ts'),
    '@vesper/bash':   resolve(root, 'packages/bash/src/index.ts'),
    '@vesper/core':   resolve(root, 'packages/core/src/index.ts'),
  },
};

const entries = [
  { entryPoints: [resolve(root, 'packages/bash/src/cli.ts')],       outfile: resolve(root, 'dist/vesper-bash.mjs'), banner: { js: '#!/usr/bin/env node' } },
  { entryPoints: [resolve(root, 'packages/tui/src/tui-client.ts')], outfile: resolve(root, 'dist/vesper-tui.mjs'),  banner: { js: esmCjsBanner } },
  { entryPoints: [resolve(root, 'packages/server/src/cli.ts')],     outfile: resolve(root, 'dist/vesper-server.mjs'), banner: { js: esmCjsBanner } },
];

mkdirSync(resolve(root, 'dist'), { recursive: true });

for (const entry of entries) {
  await esbuild.build({ ...shared, ...entry });
  console.log(`✓ ${entry.outfile.replace(root, '.')}`);
}

// ---------------------------------------------------------------------------
// Build WebUI SPA via Vite and copy into dist/web
// ---------------------------------------------------------------------------
import { execSync } from 'node:child_process';

const webDir = resolve(root, 'packages/web');
const webDist = resolve(webDir, 'dist');
const targetWeb = resolve(root, 'dist/web');

console.log('Building WebUI SPA...');
try {
  execSync('npx vite build', { cwd: webDir, stdio: 'inherit' });
  if (existsSync(webDist)) {
    cpSync(webDist, targetWeb, { recursive: true });
    console.log('✓ Copied packages/web/dist to dist/web');
  }
} catch (err) {
  console.warn('⚠ Failed to build web package automatically:', err.message);
}
