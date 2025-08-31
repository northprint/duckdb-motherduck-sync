import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'DuckDBMotherDuckSync',
      formats: ['es', 'cjs'],
      fileName: (format) => format === 'es' ? 'index.js' : 'index.cjs'
    },
    rollupOptions: {
      external: ['@duckdb/duckdb-wasm', 'fp-ts', 'io-ts', 'rxjs'],
      output: {
        globals: {
          '@duckdb/duckdb-wasm': 'DuckDB',
          'fp-ts': 'fpTs',
          'io-ts': 'ioTs',
          'rxjs': 'rxjs'
        }
      }
    },
    sourcemap: true,
    minify: false
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        'vite.config.ts'
      ]
    }
  }
});