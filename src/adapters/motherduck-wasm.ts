/**
 * MotherDuck WASM adapter using official client
 */

import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import type { TaskEither } from 'fp-ts/TaskEither';
import { MDConnection } from '@motherduck/wasm-client';
import { networkError, authError } from '../types/errors';
import type { SyncError } from '../types/errors';
import type { DbRecord } from '../types';

// MotherDuck WASM client interface (compatible with MotherDuckClient)
export interface MotherDuckWASMClient {
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
}

// Create MotherDuck WASM client
export const createMotherDuckWASMClient = (): MotherDuckWASMClient => {
  let connection: MDConnection | null = null;

  const ensureConnection = (): TaskEither<SyncError, MDConnection> =>
    connection
      ? TE.of(connection)
      : TE.left(authError('Not authenticated. Call authenticate() first.', false));

  return {
    authenticate: (token: string) =>
      TE.tryCatch(
        async () => {
          try {
            // Create new connection with token
            connection = MDConnection.create({
              mdToken: token,
            });

            // Wait for initialization
            await connection.isInitialized();

            // Test connection with a simple query
            await connection.evaluateQuery('SELECT 1');
          } catch (error) {
            connection = null;
            throw error;
          }
        },
        (error) => {
          const message = error instanceof Error ? error.message : 'Authentication failed';
          return authError(message, true);
        },
      ),

    executeSql: (sql: string) =>
      pipe(
        ensureConnection(),
        TE.chain((conn) =>
          TE.tryCatch(
            async () => {
              const result = await conn.evaluateQuery(sql);
              // Convert MDConnection result to our format
              const rows = Array.isArray(result) ? result : [];
              return {
                rows: rows as Array<DbRecord>,
                metadata: {
                  count: rows.length,
                },
              };
            },
            (error) => networkError('Query execution failed', true, undefined, { error: error instanceof Error ? error.message : String(error) }),
          ),
        ),
      ),

    uploadData: (table: string, data: ReadonlyArray<DbRecord>) =>
      pipe(
        ensureConnection(),
        TE.chain((conn) => {
          if (data.length === 0) {
            return TE.of(undefined);
          }

          // Build INSERT statement
          const firstRow = data[0];
          if (!firstRow) return TE.of(undefined);
          const columns = Object.keys(firstRow);
          const values = data.map((row) => {
            const vals = columns.map((col) => {
              const val = row[col];
              if (val === null || val === undefined) return 'NULL';
              if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
              if (typeof val === 'number') return val.toString();
              if (val instanceof Date) return `'${val.toISOString()}'`;
              return `'${JSON.stringify(val)}'`;
            });
            return `(${vals.join(', ')})`;
          });

          const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')}`;

          return TE.tryCatch(
            async () => {
              await conn.evaluateQuery(sql);
            },
            (error) => networkError('Upload failed', true, undefined, { error: error instanceof Error ? error.message : String(error) }),
          );
        }),
      ),

    downloadData: (table: string, since?: number) =>
      pipe(
        ensureConnection(),
        TE.chain((conn) => {
          const whereClause = since
            ? ` WHERE EXTRACT(EPOCH FROM updated_at) * 1000 > ${since}`
            : '';
          const sql = `SELECT * FROM ${table}${whereClause}`;

          return TE.tryCatch(
            async () => {
              const result = await conn.evaluateQuery(sql);
              return result as ReadonlyArray<DbRecord>;
            },
            (error) => networkError('Download failed', true, undefined, { error: error instanceof Error ? error.message : String(error) }),
          );
        }),
      ),
  };
};

// Create mock MotherDuck client for testing
export const createMockMotherDuckWASMClient = (): MotherDuckWASMClient => {
  const mockData: Record<string, DbRecord[]> = {
    users: [
      { id: 1, name: 'Alice', email: 'alice@example.com', created_at: new Date().toISOString() },
      { id: 2, name: 'Bob', email: 'bob@example.com', created_at: new Date().toISOString() },
    ],
  };

  return {
    authenticate: (token: string) =>
      token === 'valid-token' || token.startsWith('eyJ')
        ? TE.of(undefined)
        : TE.left(authError('Invalid token', false)),

    executeSql: () =>
      TE.of({
        rows: [],
        metadata: {},
      }),

    uploadData: () =>
      TE.of(undefined),

    downloadData: (table: string) =>
      TE.of((mockData[table] || []) as ReadonlyArray<DbRecord>),
  };
};