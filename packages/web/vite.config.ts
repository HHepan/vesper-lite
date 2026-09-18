import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@vesper/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  build: {
    outDir: resolve(__dirname, '../../dist/web'),
    emptyOutDir: true,
    // Optimize for mobile WebView
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Stable filenames for cache busting
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        // Split heavy dependencies into separate chunks for better caching
        manualChunks(id) {
          if (id.includes('node_modules/@xterm') || id.includes('node_modules/xterm')) {
            return 'xterm';
          }
          if (id.includes('node_modules/highlight.js')) {
            return 'highlightjs';
          }
          if (id.includes('node_modules/marked')) {
            return 'marked';
          }
        },
      },
    },
  },
  server: {
    // Dev server settings (not used on Android, but useful for desktop testing)
    port: 5173,
    host: true,
  },
});
