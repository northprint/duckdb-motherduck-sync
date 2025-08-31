/**
 * DuckDB WASM adapter
 */

import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import type { TaskEither } from 'fp-ts/TaskEither';
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm';
import { unknownError, validationError } from '../types/errors';
import type { SyncError } from '../types/errors';
import type { DbRecord, DbValue } from '../types/base';

// Database operations interface
export interface DatabaseOperations<T = DbRecord> {
  readonly query: (sql: string, params?: ReadonlyArray<unknown>) => TaskEither<SyncError, ReadonlyArray<T>>;
  readonly execute: (sql: string, params?: ReadonlyArray<unknown>) => TaskEither<SyncError, void>;
  readonly transaction: <R>(operations: TaskEither<SyncError, R>) => TaskEither<SyncError, R>;
}

// DuckDB configuration
export interface DuckDBConfig {
  readonly path?: string;
  readonly config?: Record<string, string>;
}

// Convert DuckDB value to DbValue
const convertValue = (value: unknown): DbValue => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  // Convert BigInt to number (may lose precision)
  if (typeof value === 'bigint') {
    return Number(value);
  }
  // Default to string representation
  return String(value);
};

// Convert row to DbRecord
const convertRow = (row: Record<string, unknown>): DbRecord => {
  const converted: Record<string, DbValue> = {};
  for (const [key, value] of Object.entries(row)) {
    converted[key] = convertValue(value);
  }
  return converted;
};

// Create DuckDB adapter
export const createDuckDBAdapter = (
  db: AsyncDuckDB,
  config?: DuckDBConfig,
): TaskEither<SyncError, DatabaseOperations> =>
  TE.tryCatch(
    async () => {
      const conn = await db.connect();
      
      // Initialize if needed
      if (config?.config) {
        for (const [key, value] of Object.entries(config.config)) {
          await conn.query(`SET ${key} = '${value}'`);
        }
      }

      const operations: DatabaseOperations = {
        query: (sql: string, params?: ReadonlyArray<unknown>) =>
          TE.tryCatch(
            async () => {
              try {
                // Prepare statement with parameters
                const preparedSql = prepareSql(sql, params);
                const result = await conn.query(preparedSql);
                
                // Convert to array of records
                const rows: DbRecord[] = [];
                for (const row of result) {
                  rows.push(convertRow(row));
                }
                
                return rows;
              } catch (error) {
                throw new Error(`Query failed: ${error instanceof Error ? error.message : String(error)}`);
              }
            },
            (error) => {
              if (error instanceof Error && error.message.includes('Query failed')) {
                return validationError(
                  'Invalid SQL query',
                  [{ path: 'sql', message: error.message }],
                  'sql',
                  sql,
                );
              }
              return unknownError('DuckDB query failed', error);
            },
          ),

        execute: (sql: string, params?: ReadonlyArray<unknown>) =>
          TE.tryCatch(
            async () => {
              const preparedSql = prepareSql(sql, params);
              await conn.query(preparedSql);
            },
            (error) => unknownError('DuckDB execute failed', error),
          ),

        transaction: <R>(operations: TaskEither<SyncError, R>): TaskEither<SyncError, R> =>
          pipe(
            TE.tryCatch<SyncError, void>(
              async () => { await conn.query('BEGIN TRANSACTION'); },
              (error) => unknownError('Failed to begin transaction', error),
            ),
            TE.chain(() => operations),
            TE.chainFirst(() =>
              TE.tryCatch<SyncError, void>(
                async () => { await conn.query('COMMIT'); },
                (error) => unknownError('Failed to commit transaction', error),
              ),
            ),
            TE.orElse((error) =>
              pipe(
                TE.tryCatch<SyncError, void>(
                  async () => { await conn.query('ROLLBACK'); },
                  () => error, // Preserve original error
                ),
                TE.chain(() => TE.left(error)),
              ),
            ),
          ),
      };

      return operations;
    },
    (error) => unknownError('Failed to create DuckDB adapter', error),
  );

// Prepare SQL with parameters (simple implementation)
const prepareSql = (sql: string, params?: ReadonlyArray<unknown>): string => {
  if (!params || params.length === 0) {
    return sql;
  }

  let preparedSql = sql;
  params.forEach((param, index) => {
    const placeholder = `$${index + 1}`;
    const value = formatValue(param);
    preparedSql = preparedSql.replace(placeholder, value);
  });

  return preparedSql;
};

// Format value for SQL
const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  if (value instanceof Uint8Array) {
    return `'\\x${Array.from(value).map(b => b.toString(16).padStart(2, '0')).join('')}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
};

// Create mock adapter for testing
export const createMockDuckDBAdapter = (): DatabaseOperations => {
  const data = new Map<string, DbRecord[]>();

  return {
    query: (sql: string) => {
      const match = sql.match(/FROM\s+(\w+)/i);
      const table = match?.[1]?.toLowerCase() || 'unknown';
      return TE.of(data.get(table) || []);
    },

    execute: (sql: string) => {
      // Simple INSERT parsing for testing
      const insertMatch = sql.match(/INSERT\s+INTO\s+(\w+)\s+VALUES\s*\((.*)\)/i);
      if (insertMatch) {
        const table = insertMatch[1]?.toLowerCase() || 'unknown';
        const values = insertMatch[2]?.split(',').map(v => v.trim().replace(/'/g, '')) || [];
        
        const record: DbRecord = {
          id: values[0] || 'test-id',
          value: values[1] || 'test-value',
        };
        
        const tableData = data.get(table) || [];
        tableData.push(record);
        data.set(table, tableData);
      }
      return TE.of(undefined);
    },

    transaction: (operations) => operations,
  };
};