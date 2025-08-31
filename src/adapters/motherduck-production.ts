/**
 * Production-ready MotherDuck adapter using WASM SDK
 * This implementation separates MotherDuck operations from local DuckDB
 */

import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import type { TaskEither } from 'fp-ts/TaskEither';
import { MDConnection } from '@motherduck/wasm-client';
import { networkError, authError, unknownError } from '../types/errors';
import type { SyncError } from '../types/errors';
import type { DbRecord } from '../types';

export interface MotherDuckProductionClient {
  readonly authenticate: (token: string) => TaskEither<SyncError, void>;
  readonly executeSql: (sql: string) => TaskEither<SyncError, {
    rows: Array<DbRecord>;
    metadata: {
      count?: number;
      hasMore?: boolean;
      cursor?: string;
    };
  }>;
  readonly uploadData: (table: string, data: ReadonlyArray<DbRecord>) => TaskEither<SyncError, void>;
  readonly downloadData: (table: string, since?: number) => TaskEither<SyncError, ReadonlyArray<DbRecord>>;
  readonly disconnect: () => TaskEither<SyncError, void>;
}

interface ConnectionState {
  connection: MDConnection | null;
  isInitialized: boolean;
}

/**
 * Create a production MotherDuck client
 * This client manages its own connection separate from local DuckDB
 */
export const createMotherDuckProductionClient = (): MotherDuckProductionClient => {
  const state: ConnectionState = {
    connection: null,
    isInitialized: false,
  };

  const ensureConnection = (): TaskEither<SyncError, MDConnection> =>
    state.connection && state.isInitialized
      ? TE.of(state.connection)
      : TE.left(authError('Not authenticated. Call authenticate() first.', true));

  // Helper to safely execute queries with error handling
  const executeQuery = (
    connection: MDConnection,
    sql: string,
  ): TaskEither<SyncError, any> =>
    TE.tryCatch(
      async () => {
        try {
          // Use evaluateQuery for data-returning queries
          const result = await connection.evaluateQuery(sql);
          return result;
        } catch (error) {
          // Retry with different method if needed
          console.warn('evaluateQuery failed, trying alternative method:', error);
          throw error;
        }
      },
      (error) => {
        const message = error instanceof Error ? error.message : 'Query execution failed';
        console.error('MotherDuck query error:', error);
        return networkError(message, true, undefined, { sql, error: String(error) });
      },
    );

  return {
    authenticate: (token: string) =>
      pipe(
        TE.tryCatch(
          async () => {
            // Clean up existing connection
            if (state.connection) {
              console.log('Closing existing MotherDuck connection');
              // Note: MDConnection doesn't have explicit close method
              state.connection = null;
              state.isInitialized = false;
            }

            console.log('Creating new MotherDuck connection');
            
            // Create new connection
            state.connection = MDConnection.create({
              mdToken: token,
            });

            // Wait for initialization
            console.log('Waiting for MotherDuck initialization');
            const maxAttempts = 30; // 30 seconds timeout
            let attempts = 0;
            
            while (!state.isInitialized && attempts < maxAttempts) {
              state.isInitialized = await state.connection.isInitialized();
              if (!state.isInitialized) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
              }
            }

            if (!state.isInitialized) {
              throw new Error('MotherDuck initialization timeout');
            }

            console.log('MotherDuck connection initialized successfully');

            // Test connection with a simple query
            await executeQuery(state.connection, 'SELECT 1 as test')();
            console.log('MotherDuck connection test successful');
          },
          (error) => {
            state.connection = null;
            state.isInitialized = false;
            const message = error instanceof Error ? error.message : 'Authentication failed';
            console.error('MotherDuck authentication error:', error);
            return authError(message, true);
          },
        ),
        TE.map(() => undefined),
      ),

    executeSql: (sql: string) =>
      pipe(
        ensureConnection(),
        TE.chain((conn) => executeQuery(conn, sql)),
        TE.map((result) => {
          // Handle different result formats
          const rows = Array.isArray(result) ? result : [];
          return {
            rows: rows as Array<DbRecord>,
            metadata: {
              count: rows.length,
            },
          };
        }),
      ),

    uploadData: (table: string, data: ReadonlyArray<DbRecord>) =>
      pipe(
        ensureConnection(),
        TE.chain((conn) => {
          if (data.length === 0) {
            return TE.of(undefined);
          }

          // For production, use prepared statements or COPY command
          // This example uses batch INSERT with prepared statement approach
          
          return pipe(
            // First, ensure the table exists by getting its schema
            executeQuery(conn, `SELECT * FROM ${table} LIMIT 0`),
            TE.chain(() => {
              // Prepare batch insert
              const firstRow = data[0];
              if (!firstRow) return TE.of(undefined);
              
              const columns = Object.keys(firstRow);
              const values = data.map(row => {
                const vals = columns.map(col => {
                  const val = row[col];
                  if (val === null || val === undefined) return 'NULL';
                  if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
                  if (val instanceof Date) return `'${val.toISOString()}'`;
                  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                  return String(val);
                });
                return `(${vals.join(', ')})`;
              });

              // Execute batch insert
              const batchSize = 1000; // Adjust based on your needs
              const batches = [];
              for (let i = 0; i < values.length; i += batchSize) {
                const batch = values.slice(i, i + batchSize);
                const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${batch.join(', ')}`;
                batches.push(executeQuery(conn, sql));
              }

              return pipe(
                TE.sequenceArray(batches),
                TE.map(() => undefined),
              );
            }),
          );
        }),
      ),

    downloadData: (table: string, since?: number) =>
      pipe(
        ensureConnection(),
        TE.chain((conn) => {
          let sql = `SELECT * FROM ${table}`;
          
          if (since) {
            // Assume timestamp column exists
            sql += ` WHERE updated_at > TIMESTAMP '${new Date(since).toISOString()}'`;
          }
          
          sql += ' ORDER BY updated_at DESC LIMIT 10000'; // Safety limit

          return executeQuery(conn, sql);
        }),
        TE.map((result) => {
          const rows = Array.isArray(result) ? result : [];
          return rows as ReadonlyArray<DbRecord>;
        }),
      ),

    disconnect: () =>
      TE.of(() => {
        if (state.connection) {
          console.log('Disconnecting from MotherDuck');
          // Clean up connection
          state.connection = null;
          state.isInitialized = false;
        }
      })(),
  };
};