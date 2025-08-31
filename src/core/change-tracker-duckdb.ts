/**
 * DuckDB-compatible change tracker
 */

import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import * as O from 'fp-ts/Option';
import type { TaskEither } from 'fp-ts/TaskEither';
import { v4 as uuidv4 } from 'uuid';
import type { Change, SyncError, DbRecord } from '../types';
import type { DatabaseOperations } from '../adapters/duckdb';
import type { StorageOperations } from '../adapters/storage';

export interface ChangeTracker {
  readonly recordChange: (change: Omit<Change, 'id' | 'timestamp'>) => TaskEither<SyncError, Change>;
  readonly getUnsyncedChanges: (since?: number) => TaskEither<SyncError, ReadonlyArray<Change>>;
  readonly markSynced: (changeIds: ReadonlyArray<string>) => TaskEither<SyncError, void>;
  readonly clearHistory: (before: number) => TaskEither<SyncError, void>;
}

export const createDuckDBChangeTracker = (
  storage: StorageOperations,
  db: DatabaseOperations,
): ChangeTracker => {
  // Initialize change tracking tables if needed
  const initializeTables = (): TaskEither<SyncError, void> =>
    pipe(
      db.execute(`
        CREATE TABLE IF NOT EXISTS _sync_changes (
          id TEXT PRIMARY KEY,
          table_name TEXT NOT NULL,
          operation TEXT NOT NULL,
          timestamp BIGINT NOT NULL,
          data TEXT NOT NULL,
          old_data TEXT,
          synced INTEGER DEFAULT 0
        )
      `),
      TE.chain(() =>
        db.execute(`
          CREATE INDEX IF NOT EXISTS idx_sync_changes_timestamp 
          ON _sync_changes(timestamp)
        `),
      ),
      TE.chain(() =>
        db.execute(`
          CREATE INDEX IF NOT EXISTS idx_sync_changes_synced 
          ON _sync_changes(synced)
        `),
      ),
    );

  // Ensure tables are initialized
  const ensureInitialized = pipe(
    storage.get<boolean>('_initialized'),
    TE.chain((initialized) =>
      O.isNone(initialized)
        ? pipe(
            initializeTables(),
            TE.chain(() => storage.set('_initialized', true)),
          )
        : TE.of(undefined),
    ),
  );

  return {
    recordChange: (changeData) =>
      pipe(
        ensureInitialized,
        TE.chain(() => {
          const change: Change = {
            id: uuidv4(),
            ...changeData,
            timestamp: Date.now(),
          };

          // Use string interpolation for DuckDB (with proper escaping)
          const dataJson = JSON.stringify(change.data).replace(/'/g, "''");
          const oldDataJson = change.oldData 
            ? `'${JSON.stringify(change.oldData).replace(/'/g, "''")}'`
            : 'NULL';

          return pipe(
            db.execute(`
              INSERT INTO _sync_changes (id, table_name, operation, timestamp, data, old_data, synced)
              VALUES ('${change.id}', '${change.table}', '${change.operation}', ${change.timestamp}, '${dataJson}', ${oldDataJson}, 0)
            `),
            TE.map(() => change),
          );
        }),
      ),

    getUnsyncedChanges: (since = 0) =>
      pipe(
        ensureInitialized,
        TE.chain(() =>
          db.query(`
            SELECT id, table_name, operation, timestamp, data, old_data
            FROM _sync_changes
            WHERE synced = 0 AND timestamp > ${since}
            ORDER BY timestamp ASC
          `),
        ),
        TE.map((rows) =>
          rows.map((row: any) => ({
            id: row.id,
            table: row.table_name,
            operation: row.operation as Change['operation'],
            timestamp: row.timestamp,
            data: JSON.parse(row.data) as DbRecord,
            oldData: row.old_data ? (JSON.parse(row.old_data) as DbRecord) : undefined,
          })),
        ),
      ),

    markSynced: (changeIds) =>
      pipe(
        ensureInitialized,
        TE.chain(() => {
          if (changeIds.length === 0) {
            return TE.of(undefined);
          }
          
          const idList = changeIds.map(id => `'${id}'`).join(', ');
          return db.execute(`
            UPDATE _sync_changes
            SET synced = 1
            WHERE id IN (${idList})
          `);
        }),
      ),

    clearHistory: (before) =>
      pipe(
        ensureInitialized,
        TE.chain(() =>
          db.execute(`
            DELETE FROM _sync_changes
            WHERE synced = 1 AND timestamp < ${before}
          `),
        ),
      ),
  };
};