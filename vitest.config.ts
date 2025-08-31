import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'test/**',
        'examples/**',
        'docs/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts', // Index files that only export
        'vite.config.ts',
        'vitest.config.ts',
        'eslint.config.js',
        'dist/**',
        'public/**',
        'server/**',
        'test-app/**',
        'test-local/**',
        // Worker files (browser environment dependent)
        '**/worker.ts',
        '**/duckdb-sync-worker.js',
        '**/duckdb-sync-worker-module.js',
        // Production adapters (require real credentials)
        '**/motherduck-production.ts',
        '**/motherduck-wasm.ts',
        '**/motherduck-rest.ts',
        '**/production.ts',
        // Simple re-export files
        '**/index-simple.ts',
        '**/engine-simple.ts',
        // Functional API (complex fp-ts testing)
        '**/duckdb-sync-functional.ts',
        // Class-based API (already tested through integration)
        '**/duckdb-sync.ts',
        // DuckDB specific implementations
        '**/change-tracker-duckdb.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});