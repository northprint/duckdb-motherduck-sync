/**
 * Change tracking for local database modifications
 */

import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import * as A from 'fp-ts/Array';
import * as O from 'fp-ts/Option';
import type { TaskEither } from 'fp-ts/TaskEither';
import { v4 as uuidv4 } from 'uuid';
import type { Change, SyncError, DbRecord } from '../types';
import type { DatabaseOperations } from '../adapters/duckdb';
import type { StorageOperations } from '../adapters/storage';
import { unknownError } from '../types/errors';

// Change tracker interface
export interface ChangeTracker {
  readonly recordChange: (change: Omit<Change, 'id' | 'timestamp'>) => TaskEither<SyncError, Change>;
  readonly getUnsyncedChanges: (since?: number) => TaskEither<SyncError, ReadonlyArray<Change>>;
  readonly markSynced: (changeIds: ReadonlyArray<string>) => TaskEither<SyncError, void>;
  readonly clearHistory: (before: number) => TaskEither<SyncError, void>;
}

// Change storage key prefix
const CHANGE_PREFIX = 'change:';
const SYNC_STATUS_PREFIX = 'sync:';

// Create change tracker
export const createChangeTracker = (
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
          timestamp INTEGER NOT NULL,
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

          return pipe(
            db.execute(
              `INSERT INTO _sync_changes (id, table_name, operation, timestamp, data, old_data, synced)
               VALUES ($1, $2, $3, $4, $5, $6, 0)`,
              [
                change.id,
                change.table,
                change.operation,
                change.timestamp,
                JSON.stringify(change.data),
                change.oldData ? JSON.stringify(change.oldData) : null,
              ],
            ),
            TE.map(() => change),
          );
        }),
      ),

    getUnsyncedChanges: (since = 0) =>
      pipe(
        ensureInitialized,
        TE.chain(() =>
          db.query<{
            id: string;
            table_name: string;
            operation: string;
            timestamp: number;
            data: string;
            old_data: string | null;
          }>(
            `SELECT id, table_name, operation, timestamp, data, old_data
             FROM _sync_changes
             WHERE synced = 0 AND timestamp > $1
             ORDER BY timestamp ASC`,
            [since],
          ),
        ),
        TE.map(
          A.map((row) => ({
            id: row['id'] as string,
            table: row['table_name'] as string,
            operation: row['operation'] as Change['operation'],
            timestamp: row['timestamp'] as number,
            data: JSON.parse(row['data'] as string) as DbRecord,
            oldData: row['old_data'] ? (JSON.parse(row['old_data'] as string) as DbRecord) : undefined,
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

          const placeholders = changeIds.map((_, i) => `$${i + 1}`).join(', ');
          return db.execute(
            `UPDATE _sync_changes SET synced = 1 WHERE id IN (${placeholders})`,
            Array.from(changeIds),
          );
        }),
      ),

    clearHistory: (before) =>
      pipe(
        ensureInitialized,
        TE.chain(() =>
          db.execute(
            `DELETE FROM _sync_changes WHERE timestamp < $1 AND synced = 1`,
            [before],
          ),
        ),
      ),
  };
};

// Create in-memory change tracker for testing
export const createMemoryChangeTracker = (): ChangeTracker & {
  getChanges: () => ReadonlyArray<Change>;
} => {
  const changes: Change[] = [];
  const syncedIds = new Set<string>();

  return {
    recordChange: (changeData) =>
      TE.of((() => {
        const change: Change = {
          id: uuidv4(),
          ...changeData,
          timestamp: Date.now(),
        };
        changes.push(change);
        return change;
      })()),

    getUnsyncedChanges: (since = 0) =>
      TE.of(
        changes.filter(
          (change) =>
            !syncedIds.has(change.id) && change.timestamp > since,
        ),
      ),

    markSynced: (changeIds) =>
      TE.of((() => {
        changeIds.forEach((id) => syncedIds.add(id));
      })()),

    clearHistory: (before) =>
      TE.of((() => {
        const toRemove = changes.filter(
          (change) =>
            change.timestamp < before && syncedIds.has(change.id),
        );
        toRemove.forEach((change) => {
          const index = changes.indexOf(change);
          if (index > -1) {
            changes.splice(index, 1);
          }
          syncedIds.delete(change.id);
        });
      })()),

    getChanges: () => [...changes],
  };
};