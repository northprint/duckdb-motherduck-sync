/**
 * Storage adapter for IndexedDB operations
 */

import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import * as O from 'fp-ts/Option';
import type { TaskEither } from 'fp-ts/TaskEither';
import type { Option } from 'fp-ts/Option';
import { unknownError } from '../types/errors';
import type { SyncError } from '../types/errors';

// Storage operations interface
export interface StorageOperations {
  readonly get: <T>(key: string) => TaskEither<SyncError, Option<T>>;
  readonly set: <T>(key: string, value: T) => TaskEither<SyncError, void>;
  readonly delete: (key: string) => TaskEither<SyncError, void>;
  readonly list: (prefix: string) => TaskEither<SyncError, ReadonlyArray<string>>;
}

// IndexedDB configuration
export interface IndexedDBConfig {
  readonly dbName: string;
  readonly storeName: string;
  readonly version?: number;
}

const defaultConfig: IndexedDBConfig = {
  dbName: 'duckdb-sync',
  storeName: 'sync-data',
  version: 1,
};

// Open IndexedDB connection
const openDB = (config: IndexedDBConfig): TaskEither<SyncError, IDBDatabase> =>
  TE.tryCatch(
    () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(config.dbName, config.version);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(config.storeName)) {
            db.createObjectStore(config.storeName);
          }
        };
      }),
    (error) => unknownError('Failed to open IndexedDB', error),
  );

// Execute transaction
const executeTransaction = <T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): TaskEither<SyncError, T> =>
  TE.tryCatch(
    () =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction([storeName], mode);
        const store = transaction.objectStore(storeName);
        const request = operation(store);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      }),
    (error) => unknownError('Transaction failed', error),
  );

// Create IndexedDB storage adapter
export const createIndexedDBAdapter = (
  config: IndexedDBConfig = defaultConfig,
): TaskEither<SyncError, StorageOperations> =>
  pipe(
    openDB(config),
    TE.map((db) => {
      const storageOps: StorageOperations = {
        get: <T>(key: string): TaskEither<SyncError, Option<T>> =>
          pipe(
            executeTransaction(
              db,
              config.storeName,
              'readonly',
              (store) => store.get(key),
            ),
            TE.map((value) => (value !== undefined ? O.some(value as T) : O.none)),
          ),

        set: <T>(key: string, value: T): TaskEither<SyncError, void> =>
          pipe(
            executeTransaction(
              db,
              config.storeName,
              'readwrite',
              (store) => store.put(value, key),
            ),
            TE.map(() => undefined),
          ),

        delete: (key: string): TaskEither<SyncError, void> =>
          pipe(
            executeTransaction(
              db,
              config.storeName,
              'readwrite',
              (store) => store.delete(key),
            ),
            TE.map(() => undefined),
          ),

        list: (prefix: string): TaskEither<SyncError, ReadonlyArray<string>> =>
          pipe(
            executeTransaction(
              db,
              config.storeName,
              'readonly',
              (store) => store.getAllKeys(),
            ),
            TE.map((keys) =>
              keys
                .filter((key) => typeof key === 'string' && key.startsWith(prefix))
                .map((key) => key as string),
            ),
          ),
      };

      return storageOps;
    }),
  );

// In-memory storage adapter for testing
export const createMemoryAdapter = (): StorageOperations => {
  const storage = new Map<string, unknown>();

  return {
    get: <T>(key: string): TaskEither<SyncError, Option<T>> =>
      TE.of(storage.has(key) ? O.some(storage.get(key) as T) : O.none),

    set: <T>(key: string, value: T): TaskEither<SyncError, void> =>
      TE.of(void storage.set(key, value)),

    delete: (key: string): TaskEither<SyncError, void> =>
      TE.of(void storage.delete(key)),

    list: (prefix: string): TaskEither<SyncError, ReadonlyArray<string>> =>
      TE.of(
        Array.from(storage.keys()).filter((key) => key.startsWith(prefix)),
      ),
  };
};