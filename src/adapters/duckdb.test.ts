/**
 * Tests for DuckDB adapter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import { createMockDuckDBAdapter, createDuckDBAdapter } from './duckdb';
import type { DatabaseOperations } from './duckdb';
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm';

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

  describe('Real DuckDB Adapter', () => {
    it('should create adapter with config', async () => {
      const mockConn = {
        query: vi.fn().mockResolvedValue([]),
      };
      
      const mockDb = {
        connect: vi.fn().mockResolvedValue(mockConn),
      } as unknown as AsyncDuckDB;

      const result = await pipe(
        createDuckDBAdapter(mockDb, {
          config: {
            'temp_directory': '/tmp',
            'max_memory': '1GB'
          }
        })
      )();

      expect(result._tag).toBe('Right');
      expect(mockDb.connect).toHaveBeenCalled();
      expect(mockConn.query).toHaveBeenCalledWith("SET temp_directory = '/tmp'");
      expect(mockConn.query).toHaveBeenCalledWith("SET max_memory = '1GB'");
    });

    it('should handle query with parameters', async () => {
      const mockConn = {
        query: vi.fn().mockResolvedValue([
          { id: 1, name: 'Alice', age: 30 }
        ]),
      };
      
      const mockDb = {
        connect: vi.fn().mockResolvedValue(mockConn),
      } as unknown as AsyncDuckDB;

      const adapterResult = await pipe(createDuckDBAdapter(mockDb))();
      expect(adapterResult._tag).toBe('Right');
      
      if (adapterResult._tag === 'Right') {
        const adapter = adapterResult.right;
        const result = await pipe(
          adapter.query('SELECT * FROM users WHERE id = $1', [1])
        )();
        
        expect(result._tag).toBe('Right');
        if (result._tag === 'Right') {
          expect(result.right).toHaveLength(1);
          expect(result.right[0]).toEqual({ id: 1, name: 'Alice', age: 30 });
        }
        
        expect(mockConn.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id = 1');
      }
    });

    it('should handle various parameter types', async () => {
      const mockConn = {
        query: vi.fn().mockResolvedValue([]),
      };
      
      const mockDb = {
        connect: vi.fn().mockResolvedValue(mockConn),
      } as unknown as AsyncDuckDB;

      const adapterResult = await pipe(createDuckDBAdapter(mockDb))();
      expect(adapterResult._tag).toBe('Right');
      
      if (adapterResult._tag === 'Right') {
        const adapter = adapterResult.right;
        
        // Test null parameter
        await pipe(adapter.execute('INSERT INTO test VALUES ($1)', [null]))();
        expect(mockConn.query).toHaveBeenCalledWith('INSERT INTO test VALUES (NULL)');
        
        // Test string with quotes
        await pipe(adapter.execute('INSERT INTO test VALUES ($1)', ["O'Brien"]))();
        expect(mockConn.query).toHaveBeenCalledWith("INSERT INTO test VALUES ('O''Brien')");
        
        // Test date parameter
        const date = new Date('2024-01-01T00:00:00.000Z');
        await pipe(adapter.execute('INSERT INTO test VALUES ($1)', [date]))();
        expect(mockConn.query).toHaveBeenCalledWith("INSERT INTO test VALUES ('2024-01-01T00:00:00.000Z')");
        
        // Test Uint8Array parameter
        const bytes = new Uint8Array([0x01, 0x02, 0xff]);
        await pipe(adapter.execute('INSERT INTO test VALUES ($1)', [bytes]))();
        expect(mockConn.query).toHaveBeenCalledWith("INSERT INTO test VALUES ('\\x0102ff')");
        
        // Test boolean parameter
        await pipe(adapter.execute('INSERT INTO test VALUES ($1)', [true]))();
        expect(mockConn.query).toHaveBeenCalledWith('INSERT INTO test VALUES (true)');
      }
    });

    it('should handle query errors', async () => {
      const mockConn = {
        query: vi.fn().mockRejectedValue(new Error('Query failed: syntax error')),
      };
      
      const mockDb = {
        connect: vi.fn().mockResolvedValue(mockConn),
      } as unknown as AsyncDuckDB;

      const adapterResult = await pipe(createDuckDBAdapter(mockDb))();
      expect(adapterResult._tag).toBe('Right');
      
      if (adapterResult._tag === 'Right') {
        const adapter = adapterResult.right;
        const result = await pipe(adapter.query('INVALID SQL'))();
        
        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left.type).toBe('validation-error');
          expect(result.left.message).toBe('Invalid SQL query');
        }
      }
    });

    it('should handle connection errors', async () => {
      const mockDb = {
        connect: vi.fn().mockRejectedValue(new Error('Connection failed')),
      } as unknown as AsyncDuckDB;

      const result = await pipe(createDuckDBAdapter(mockDb))();
      
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('unknown-error');
        expect(result.left.message).toBe('Failed to create DuckDB adapter');
      }
    });

    it('should handle transactions', async () => {
      const mockConn = {
        query: vi.fn()
          .mockResolvedValueOnce(undefined) // BEGIN
          .mockResolvedValueOnce([{ count: 5 }]) // SELECT
          .mockResolvedValueOnce(undefined), // COMMIT
      };
      
      const mockDb = {
        connect: vi.fn().mockResolvedValue(mockConn),
      } as unknown as AsyncDuckDB;

      const adapterResult = await pipe(createDuckDBAdapter(mockDb))();
      expect(adapterResult._tag).toBe('Right');
      
      if (adapterResult._tag === 'Right') {
        const adapter = adapterResult.right;
        const result = await pipe(
          adapter.transaction(
            adapter.query('SELECT COUNT(*) as count FROM users')
          )
        )();
        
        expect(result._tag).toBe('Right');
        if (result._tag === 'Right') {
          expect(result.right[0]).toEqual({ count: 5 });
        }
        
        expect(mockConn.query).toHaveBeenCalledWith('BEGIN TRANSACTION');
        expect(mockConn.query).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM users');
        expect(mockConn.query).toHaveBeenCalledWith('COMMIT');
      }
    });

    it('should rollback transaction on error', async () => {
      const mockConn = {
        query: vi.fn()
          .mockResolvedValueOnce(undefined) // BEGIN
          .mockRejectedValueOnce(new Error('Query error')) // SELECT fails
          .mockResolvedValueOnce(undefined), // ROLLBACK
      };
      
      const mockDb = {
        connect: vi.fn().mockResolvedValue(mockConn),
      } as unknown as AsyncDuckDB;

      const adapterResult = await pipe(createDuckDBAdapter(mockDb))();
      expect(adapterResult._tag).toBe('Right');
      
      if (adapterResult._tag === 'Right') {
        const adapter = adapterResult.right;
        const result = await pipe(
          adapter.transaction(
            adapter.query('SELECT * FROM invalid_table')
          )
        )();
        
        expect(result._tag).toBe('Left');
        expect(mockConn.query).toHaveBeenCalledWith('BEGIN TRANSACTION');
        expect(mockConn.query).toHaveBeenCalledWith('ROLLBACK');
      }
    });

    it('should convert various value types', async () => {
      const mockConn = {
        query: vi.fn().mockResolvedValue([
          {
            id: 1,
            bigint_val: BigInt('9007199254740993'), // Larger than MAX_SAFE_INTEGER
            null_val: null,
            undefined_val: undefined,
            date_val: new Date('2024-01-01'),
            binary_val: new Uint8Array([1, 2, 3]),
            object_val: { nested: 'value' },
          }
        ]),
      };
      
      const mockDb = {
        connect: vi.fn().mockResolvedValue(mockConn),
      } as unknown as AsyncDuckDB;

      const adapterResult = await pipe(createDuckDBAdapter(mockDb))();
      expect(adapterResult._tag).toBe('Right');
      
      if (adapterResult._tag === 'Right') {
        const adapter = adapterResult.right;
        const result = await pipe(adapter.query('SELECT * FROM test'))();
        
        expect(result._tag).toBe('Right');
        if (result._tag === 'Right') {
          const row = result.right[0];
          expect(row.id).toBe(1);
          expect(row.bigint_val).toBe(9007199254740992); // Converted to number (with precision loss)
          expect(row.null_val).toBeNull();
          expect(row.undefined_val).toBeNull();
          expect(row.date_val).toBeInstanceOf(Date);
          expect(row.binary_val).toBeInstanceOf(Uint8Array);
          expect(row.object_val).toBe('[object Object]'); // Converted to string
        }
      }
    });
  });

  describe('SQL preparation edge cases', () => {
    it('should handle empty parameters array', async () => {
      const mockConn = {
        query: vi.fn().mockResolvedValue([]),
      };
      
      const mockDb = {
        connect: vi.fn().mockResolvedValue(mockConn),
      } as unknown as AsyncDuckDB;

      const adapterResult = await pipe(createDuckDBAdapter(mockDb))();
      expect(adapterResult._tag).toBe('Right');
      
      if (adapterResult._tag === 'Right') {
        const adapter = adapterResult.right;
        await pipe(adapter.query('SELECT * FROM users', []))();
        expect(mockConn.query).toHaveBeenCalledWith('SELECT * FROM users');
      }
    });

    it('should handle multiple parameters', async () => {
      const mockConn = {
        query: vi.fn().mockResolvedValue([]),
      };
      
      const mockDb = {
        connect: vi.fn().mockResolvedValue(mockConn),
      } as unknown as AsyncDuckDB;

      const adapterResult = await pipe(createDuckDBAdapter(mockDb))();
      expect(adapterResult._tag).toBe('Right');
      
      if (adapterResult._tag === 'Right') {
        const adapter = adapterResult.right;
        await pipe(
          adapter.query(
            'SELECT * FROM users WHERE name = $1 AND age > $2 AND active = $3',
            ['Alice', 25, true]
          )
        )();
        expect(mockConn.query).toHaveBeenCalledWith(
          "SELECT * FROM users WHERE name = 'Alice' AND age > 25 AND active = true"
        );
      }
    });

    it('should handle general object conversion to string', async () => {
      const mockConn = {
        query: vi.fn().mockResolvedValue([]),
      };
      
      const mockDb = {
        connect: vi.fn().mockResolvedValue(mockConn),
      } as unknown as AsyncDuckDB;

      const adapterResult = await pipe(createDuckDBAdapter(mockDb))();
      expect(adapterResult._tag).toBe('Right');
      
      if (adapterResult._tag === 'Right') {
        const adapter = adapterResult.right;
        const customObj = { toString: () => 'custom-string' };
        await pipe(adapter.execute('INSERT INTO test VALUES ($1)', [customObj]))();
        expect(mockConn.query).toHaveBeenCalledWith("INSERT INTO test VALUES ('custom-string')");
      }
    });

    it('should handle execute errors', async () => {
      const mockConn = {
        query: vi.fn().mockRejectedValue(new Error('Execute failed')),
      };
      
      const mockDb = {
        connect: vi.fn().mockResolvedValue(mockConn),
      } as unknown as AsyncDuckDB;

      const adapterResult = await pipe(createDuckDBAdapter(mockDb))();
      expect(adapterResult._tag).toBe('Right');
      
      if (adapterResult._tag === 'Right') {
        const adapter = adapterResult.right;
        const result = await pipe(adapter.execute('DELETE FROM users'))();
        
        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left.type).toBe('unknown-error');
          expect(result.left.message).toBe('DuckDB execute failed');
        }
      }
    });
  });
});