import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  publicDir: '../public',
  server: {
    port: 5173,
    open: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    fs: {
      allow: ['..'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
      '/src': path.resolve(__dirname, '../src'),
      '/public': path.resolve(__dirname, '../public'),
    },
  },
  optimizeDeps: {
    include: ['@duckdb/duckdb-wasm'],
    exclude: ['@motherduck/wasm-client', 'fp-ts'],
  },
  assetsInclude: ['**/*.wasm'],
});