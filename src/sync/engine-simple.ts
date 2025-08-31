/**
 * Simplified sync engine for testing
 */

import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import type { TaskEither } from 'fp-ts/TaskEither';
import { Subject, Observable } from 'rxjs';
import type {
  SyncConfig,
  SyncState,
  SyncResult,
  PushResult,
  PullResult,
  SyncError,
  Change,
} from '../types';
import type { NetworkMonitor } from '../core/network-monitor';
import type { ChangeTracker } from '../core/change-tracker';
import type { DatabaseOperations } from '../adapters/duckdb';
import type { MotherDuckClient } from '../adapters/motherduck';

export interface SyncEngine {
  readonly initialize: (config: SyncConfig) => TaskEither<SyncError, void>;
  readonly sync: () => TaskEither<SyncError, SyncResult>;
  readonly push: () => TaskEither<SyncError, PushResult>;
  readonly pull: () => TaskEither<SyncError, PullResult>;
  readonly startAutoSync: () => Observable<SyncState>;
  readonly stopAutoSync: () => void;
  readonly syncState$: Observable<SyncState>;
}

export interface SyncEngineDeps {
  readonly networkMonitor: NetworkMonitor;
  readonly changeTracker: ChangeTracker;
  readonly localDb: DatabaseOperations;
  readonly motherduckClient: MotherDuckClient;
}

export const createSimpleSyncEngine = (deps: SyncEngineDeps): SyncEngine => {
  const { changeTracker, motherduckClient } = deps;
  
  const stateSubject = new Subject<SyncState>();
  let config: SyncConfig | null = null;

  const updateState = (state: SyncState): void => {
    stateSubject.next(state);
  };

  const initialize: SyncEngine['initialize'] = (syncConfig) =>
    pipe(
      motherduckClient.authenticate(syncConfig.motherduckToken),
      TE.map(() => {
        config = syncConfig;
        updateState({ type: 'idle' });
      }),
    );

  const push: SyncEngine['push'] = () =>
    pipe(
      changeTracker.getUnsyncedChanges(),
      TE.chain((changes) => {
        if (changes.length === 0) {
          return TE.of({ uploaded: 0, failed: 0, errors: [] });
        }

        // Group by table and upload
        const changesByTable = changes.reduce((acc, change) => {
          const table = change.table;
          if (!acc[table]) {
            acc[table] = [];
          }
          (acc[table] as Change[]).push(change);
          return acc;
        }, {} as Record<string, typeof changes>);

        return pipe(
          TE.of(Object.entries(changesByTable)),
          TE.chain((entries) =>
            TE.sequenceArray(
              entries.map(([table, tableChanges]) =>
                pipe(
                  motherduckClient.uploadData(
                    table,
                    tableChanges.map((c) => c.data),
                  ),
                  TE.map(() => tableChanges.length),
                ),
              ),
            ),
          ),
          TE.chain((results) => {
            const uploaded = results.reduce((sum, count) => sum + count, 0);
            return pipe(
              changeTracker.markSynced(changes.map((c) => c.id) as ReadonlyArray<string>),
              TE.map(() => ({ uploaded, failed: 0, errors: [] })),
            );
          }),
        );
      }),
    );

  const pull: SyncEngine['pull'] = () =>
    pipe(
      TE.of(config?.tables || []),
      TE.chain((tables) => {
        if (tables.length === 0) {
          return TE.of({ downloaded: 0, applied: 0, failed: 0, errors: [] });
        }
        // Simplified: just return success for now
        return TE.of({ downloaded: 0, applied: 0, failed: 0, errors: [] });
      }),
    );

  const sync: SyncEngine['sync'] = () =>
    pipe(
      TE.Do,
      TE.bind('startTime', () => TE.of(Date.now())),
      TE.bind('pushResult', () => push()),
      TE.bind('pullResult', () => pull()),
      TE.map(({ startTime, pushResult, pullResult }) => ({
        pushed: pushResult.uploaded,
        pulled: pullResult.applied,
        conflicts: [],
        errors: [],
        duration: Date.now() - startTime,
      })),
    );

  const startAutoSync: SyncEngine['startAutoSync'] = () => {
    updateState({ type: 'idle' });
    return stateSubject.asObservable();
  };

  const stopAutoSync: SyncEngine['stopAutoSync'] = () => {
    updateState({ type: 'idle' });
  };

  return {
    initialize,
    sync,
    push,
    pull,
    startAutoSync,
    stopAutoSync,
    syncState$: stateSubject.asObservable(),
  };
};