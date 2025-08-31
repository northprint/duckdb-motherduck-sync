/**
 * Base types for DuckDB-MotherDuck sync middleware
 */

import type { Either } from 'fp-ts/Either';
import type { Task } from 'fp-ts/Task';
import type { Observable } from 'rxjs';

// Utility types
export type ReadonlyRecord<K extends string | number | symbol, V> = Readonly<Record<K, V>>;

// Timestamp type (Unix milliseconds)
export type Timestamp = number;

// Database value types
export type DbValue = string | number | boolean | null | Date | Uint8Array;
export type DbRecord = ReadonlyRecord<string, DbValue>;

// Operation types
export type OperationType = 'INSERT' | 'UPDATE' | 'DELETE';

// Change tracking
export interface Change {
  readonly id: string;
  readonly table: string;
  readonly operation: OperationType;
  readonly timestamp: Timestamp;
  readonly data: DbRecord;
  readonly oldData?: DbRecord;
}

// Conflict information
export interface Conflict {
  readonly table: string;
  readonly key: DbRecord;
  readonly localValue: DbRecord;
  readonly remoteValue: DbRecord;
  readonly localTimestamp: Timestamp;
  readonly remoteTimestamp: Timestamp;
}

// Conflict resolution strategies
export type ConflictStrategy =
  | { readonly type: 'local-wins' }
  | { readonly type: 'remote-wins' }
  | { readonly type: 'latest-wins' }
  | { readonly type: 'merge'; readonly mergeFunction: MergeFunction }
  | { readonly type: 'manual' };

export type MergeFunction = (
  local: DbRecord,
  remote: DbRecord,
  base?: DbRecord,
) => Either<Error, DbRecord>;

// Sync configuration
export interface SyncConfig {
  readonly motherduckToken: string;
  readonly syncInterval?: number;
  readonly conflictStrategy?: ConflictStrategy;
  readonly tables?: ReadonlyArray<string>;
  readonly batchSize?: number;
  readonly motherduckApiUrl?: string;
  readonly enableCompression?: boolean;
  readonly compressionThreshold?: number; // bytes
  readonly tableFilter?: {
    readonly includeTables?: ReadonlyArray<string>;
    readonly excludeTables?: ReadonlyArray<string>;
    readonly includePatterns?: ReadonlyArray<string>; // Will be converted to RegExp
    readonly excludePatterns?: ReadonlyArray<string>; // Will be converted to RegExp
  };
  readonly useWebWorker?: boolean;
  readonly workerPoolSize?: number;
}

// Sync states
export type SyncState =
  | { readonly type: 'idle' }
  | { readonly type: 'syncing'; readonly progress: number }
  | { readonly type: 'error'; readonly error: Error }
  | { readonly type: 'conflict'; readonly conflicts: ReadonlyArray<Conflict> };

// Network states
export interface NetworkState {
  readonly online: boolean;
  readonly type: 'wifi' | 'cellular' | 'ethernet' | 'unknown';
  readonly effectiveType?: '4g' | '3g' | '2g' | 'slow-2g';
}

// Results
export interface SyncResult {
  readonly pushed: number;
  readonly pulled: number;
  readonly conflicts: ReadonlyArray<Conflict>;
  readonly errors: ReadonlyArray<Error>;
  readonly duration: number;
}

export interface PushResult {
  readonly uploaded: number;
  readonly failed: number;
  readonly errors: ReadonlyArray<Error>;
}

export interface PullResult {
  readonly downloaded: number;
  readonly applied: number;
  readonly errors: ReadonlyArray<Error>;
}

// Task type alias for async operations
export type AsyncTask<A> = Task<Either<Error, A>>;

// Observable type alias for streams
export type Stream<A> = Observable<A>;