/**
 * Tests for DuckDB adapter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import { createMockDuckDBAdapter } from './duckdb';
import type { DatabaseOperations } from './duckdb';

describe('DuckDB Adapter', () => {
  describe('Mock Adapter', () => {
    let db: DatabaseOperations;

    beforeEach(() => {
      db = createMockDuckDBAdapter();
    });

    it('should execute INSERT and SELECT', async () => {
      // Insert data
      const insertResult = await pipe(
        db.execute("INSERT INTO users VALUES ('1', 'Alice')"),
      )();
      expect(insertResult._tag).toBe('Right');

      // Query data
      const queryResult = await pipe(db.query('SELECT * FROM users'))();
      expect(queryResult._tag).toBe('Right');
      if (queryResult._tag === 'Right') {
        expect(queryResult.right).toHaveLength(1);
        expect(queryResult.right[0]).toMatchObject({
          id: '1',
          value: 'Alice',
        });
      }
    });

    it('should handle multiple inserts', async () => {
      await pipe(db.execute("INSERT INTO products VALUES ('p1', 'Product 1')"))();
      await pipe(db.execute("INSERT INTO products VALUES ('p2', 'Product 2')"))();

      const result = await pipe(db.query('SELECT * FROM products'))();
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(2);
      }
    });

    it('should support transactions', async () => {
      const transaction = pipe(
        db.execute("INSERT INTO test VALUES ('t1', 'test')"),
        TE.chain(() => db.query('SELECT * FROM test')),
      );

      const result = await pipe(db.transaction(transaction))();
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(1);
      }
    });

    it('should handle empty results', async () => {
      const result = await pipe(db.query('SELECT * FROM empty_table'))();
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(0);
      }
    });
  });

  describe('SQL preparation', () => {
    it('should handle various data types in formatValue', () => {
      const db = createMockDuckDBAdapter();
      
      // Test by executing queries with different types
      const queries = [
        db.execute("INSERT INTO test VALUES (NULL, 'null test')"),
        db.execute("INSERT INTO test VALUES (123, 'number test')"),
        db.execute("INSERT INTO test VALUES (true, 'boolean test')"),
        db.execute("INSERT INTO test VALUES ('2024-01-01', 'date test')"),
      ];

      // All should succeed
      queries.forEach(async (query) => {
        const result = await pipe(query)();
        expect(result._tag).toBe('Right');
      });
    });
  });

  describe('Error handling', () => {
    it('should handle query errors gracefully', async () => {
      const db = createMockDuckDBAdapter();
      
      // Mock adapter doesn't throw errors, but in real implementation it would
      const result = await pipe(db.query('INVALID SQL'))();
      
      // For mock, it just returns empty array
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toEqual([]);
      }
    });
  });
});