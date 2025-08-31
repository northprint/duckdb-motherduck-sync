/**
 * DuckDB-MotherDuck Sync Library (Functional Programming Version)
 * 
 * シンプルな同期ライブラリ - MotherDuckトークンだけで動作
 * fp-tsを使用した関数型プログラミング実装
 */

import * as TE from 'fp-ts/TaskEither';
import * as O from 'fp-ts/Option';
import * as IO from 'fp-ts/IO';
import { pipe } from 'fp-ts/function';
import * as A from 'fp-ts/Array';
import * as R from 'fp-ts/Record';

// Types
export interface SyncConfig {
  readonly motherduckToken: O.Option<string>;
  readonly syncInterval: number;
  readonly autoSync: boolean;
  readonly syncWorkerPath: string;
  readonly wasmPath?: string;
  readonly workerPath?: string;
}

export interface DuckDBConnection {
  readonly db: any;
  readonly conn: any;
}

export interface SyncState {
  readonly config: SyncConfig;
  readonly connection: O.Option<DuckDBConnection>;
  readonly syncWorker: O.Option<Worker>;
  readonly syncInProgress: boolean;
  readonly listeners: Map<string, Array<(data: any) => void>>;
  readonly syncInterval: O.Option<NodeJS.Timeout>;
}

export interface Change {
  readonly id: string;
  readonly table_name: string;
  readonly record_id: string;
  readonly operation: 'INSERT' | 'UPDATE' | 'DELETE';
  readonly data: any;
  readonly created_at: Date;
  readonly synced: boolean;
}

// Error types
export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

// Default configuration
export const defaultConfig: SyncConfig = {
  motherduckToken: O.none,
  syncInterval: 30000,
  autoSync: true,
  syncWorkerPath: '/public/duckdb-sync-worker.js',
};

// State management
export const createInitialState = (config: Partial<SyncConfig> = {}): SyncState => ({
  config: { ...defaultConfig, ...config },
  connection: O.none,
  syncWorker: O.none,
  syncInProgress: false,
  listeners: new Map(),
  syncInterval: O.none,
});

// Event emitter functions
export const emit = (state: SyncState) => (event: string) => (data?: any): IO.IO<void> => () => {
  const callbacks = state.listeners.get(event);
  if (callbacks) {
    callbacks.forEach(cb => cb(data));
  }
};

export const on = (state: SyncState) => (event: string) => (callback: (data: any) => void): IO.IO<SyncState> => () => {
  const newListeners = new Map(state.listeners);
  if (!newListeners.has(event)) {
    newListeners.set(event, []);
  }
  newListeners.get(event)!.push(callback);
  return { ...state, listeners: newListeners };
};

export const off = (state: SyncState) => (event: string) => (callback: (data: any) => void): IO.IO<SyncState> => () => {
  const newListeners = new Map(state.listeners);
  const callbacks = newListeners.get(event);
  if (callbacks) {
    const index = callbacks.indexOf(callback);
    if (index !== -1) {
      callbacks.splice(index, 1);
    }
  }
  return { ...state, listeners: newListeners };
};

// DuckDB initialization
export const initializeDuckDB = (config: SyncConfig): TE.TaskEither<SyncError, DuckDBConnection> =>
  TE.tryCatch(
    async () => {
      const duckdb = await import('@duckdb/duckdb-wasm');
      
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const DUCKDB_CONFIG = await duckdb.selectBundle({
        mvp: {
          mainModule: config.wasmPath || `${baseUrl}/node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm`,
          mainWorker: config.workerPath || `${baseUrl}/node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js`,
        },
        eh: {
          mainModule: config.wasmPath || `${baseUrl}/node_modules/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm`,
          mainWorker: config.workerPath || `${baseUrl}/node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js`,
        },
      });
      
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      const worker = new Worker(DUCKDB_CONFIG.mainWorker);
      
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(DUCKDB_CONFIG.mainModule, DUCKDB_CONFIG.pthreadWorker);
      
      const conn = await db.connect();
      
      // Initialize sync metadata tables
      await conn.query(`
        CREATE TABLE IF NOT EXISTS _sync_metadata (
          table_name VARCHAR PRIMARY KEY,
          last_sync TIMESTAMP,
          sync_version INTEGER DEFAULT 0
        )
      `);
      
      await conn.query(`
        CREATE TABLE IF NOT EXISTS _sync_changes (
          id VARCHAR PRIMARY KEY,
          table_name VARCHAR NOT NULL,
          record_id VARCHAR NOT NULL,
          operation VARCHAR NOT NULL,
          data JSON,
          created_at TIMESTAMP DEFAULT NOW(),
          synced BOOLEAN DEFAULT false
        )
      `);
      
      return { db, conn };
    },
    (error): SyncError => new SyncError(`Failed to initialize DuckDB: ${error}`)
  );

// Worker initialization
export const initializeSyncWorker = (config: SyncConfig): TE.TaskEither<SyncError, Worker> =>
  pipe(
    config.motherduckToken,
    O.fold(
      () => TE.left(new SyncError('MotherDuck token not provided')),
      (token) => TE.tryCatch(
        () => new Promise<Worker>((resolve, reject) => {
          const worker = new Worker(config.syncWorkerPath);
          const timeout = setTimeout(() => reject(new Error('Worker initialization timeout')), 10000);
          
          worker.onmessage = (event) => {
            if (event.data.type === 'INITIALIZED') {
              clearTimeout(timeout);
              resolve(worker);
            } else if (event.data.type === 'ERROR') {
              clearTimeout(timeout);
              reject(new Error(event.data.error));
            }
          };
          
          worker.postMessage({
            type: 'INITIALIZE',
            token
          });
        }),
        (error): SyncError => new SyncError(`Failed to initialize sync worker: ${error}`)
      )
    )
  );

// Initialize complete sync system
export const initialize = (state: SyncState): TE.TaskEither<SyncError, SyncState> =>
  pipe(
    initializeDuckDB(state.config),
    TE.chain((connection) =>
      pipe(
        state.config.motherduckToken,
        O.fold(
          () => TE.of({ ...state, connection: O.some(connection) }),
          () => pipe(
            initializeSyncWorker(state.config),
            TE.map((worker) => ({
              ...state,
              connection: O.some(connection),
              syncWorker: O.some(worker)
            }))
          )
        )
      )
    ),
    TE.chainFirst(() => TE.fromIO(emit(state)('initialized')()))
  );

// Track table for sync
export const trackTable = (state: SyncState) => (tableName: string) => (options: { trackQuery?: string } = {}): TE.TaskEither<SyncError, void> =>
  pipe(
    state.connection,
    O.fold(
      () => TE.left(new SyncError('Database not initialized')),
      ({ conn }) => TE.tryCatch(
        async () => {
          const trackQuery = options.trackQuery || `
            CREATE TRIGGER IF NOT EXISTS ${tableName}_sync_trigger
            AFTER INSERT OR UPDATE OR DELETE ON ${tableName}
            BEGIN
              INSERT INTO _sync_changes (id, table_name, record_id, operation, data)
              VALUES (
                'change_' || strftime('%s', 'now') || '_' || random(),
                '${tableName}',
                CASE 
                  WHEN NEW.id IS NOT NULL THEN NEW.id
                  ELSE OLD.id
                END,
                CASE
                  WHEN OLD.id IS NULL THEN 'INSERT'
                  WHEN NEW.id IS NULL THEN 'DELETE'
                  ELSE 'UPDATE'
                END,
                CASE
                  WHEN NEW.id IS NOT NULL THEN to_json(NEW)
                  ELSE to_json(OLD)
                END
              );
            END;
          `;
          
          await conn.query(trackQuery);
          
          await conn.query(`
            INSERT INTO _sync_metadata (table_name) 
            VALUES ('${tableName}')
            ON CONFLICT (table_name) DO NOTHING
          `);
          
          emit(state)('table-tracked')({ tableName })();
        },
        (error): SyncError => new SyncError(`Failed to track table: ${error}`)
      )
    )
  );

// Query execution
export const query = (state: SyncState) => (sql: string) => (params: any[] = []): TE.TaskEither<SyncError, any[]> =>
  pipe(
    state.connection,
    O.fold(
      () => TE.left(new SyncError('Database not initialized')),
      ({ conn }) => TE.tryCatch(
        async () => {
          const result = await conn.query(sql, params);
          return result.toArray();
        },
        (error): SyncError => new SyncError(`Query failed: ${error}`)
      )
    )
  );

// Get pending changes
export const getPendingChanges = (state: SyncState): TE.TaskEither<SyncError, Change[]> =>
  query(state)(`
    SELECT * FROM _sync_changes WHERE NOT synced
    ORDER BY created_at
  `)();

// Get table schemas
export const getTableSchemas = (state: SyncState): TE.TaskEither<SyncError, Record<string, any[]>> =>
  pipe(
    query(state)('SELECT DISTINCT table_name FROM _sync_metadata')(),
    TE.chain((tables) =>
      pipe(
        tables.map(t => t.table_name),
        A.traverse(TE.ApplicativePar)((tableName: string) =>
          pipe(
            query(state)(`
              SELECT column_name, data_type 
              FROM information_schema.columns 
              WHERE table_name = '${tableName}'
            `)(),
            TE.map((schema) => [tableName, schema] as const)
          )
        ),
        TE.map(R.fromEntries)
      )
    )
  );

// Send message to worker
export const sendToWorker = (worker: Worker) => (message: any): TE.TaskEither<SyncError, any> =>
  TE.tryCatch(
    () => new Promise((resolve, reject) => {
      const id = Math.random().toString(36).substring(2, 11);
      
      const handler = (event: MessageEvent) => {
        if (event.data.id === id) {
          worker.removeEventListener('message', handler);
          
          if (event.data.type === 'SUCCESS') {
            resolve(event.data.result);
          } else {
            reject(new Error(event.data.error));
          }
        }
      };
      
      worker.addEventListener('message', handler);
      worker.postMessage({ ...message, id });
    }),
    (error): SyncError => new SyncError(`Worker communication failed: ${error}`)
  );

// Mark changes as synced
export const markChangesSynced = (state: SyncState) => (changes: Change[]): TE.TaskEither<SyncError, void> =>
  pipe(
    changes,
    A.traverse(TE.ApplicativeSeq)((change) =>
      query(state)(`UPDATE _sync_changes SET synced = true WHERE id = '${change.id}'`)()
    ),
    TE.map(() => undefined)
  );

// Apply pulled changes
export const applyPulledChanges = (state: SyncState) => (changes: any[]): TE.TaskEither<SyncError, void> =>
  pipe(
    changes,
    A.traverse(TE.ApplicativeSeq)((change) => {
      const { table_name, operation, data } = change;
      
      if (operation === 'INSERT') {
        const columns = Object.keys(data).join(', ');
        const values = Object.values(data).map(v => 
          typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v
        ).join(', ');
        
        const conflictUpdate = Object.keys(data)
          .map(k => `${k} = EXCLUDED.${k}`)
          .join(', ');
        
        return query(state)(`
          INSERT INTO ${table_name} (${columns}) 
          VALUES (${values})
          ON CONFLICT DO UPDATE SET ${conflictUpdate}
        `)();
      }
      
      return TE.of(undefined);
    }),
    TE.map(() => undefined)
  );

// Main sync function
export const sync = (state: SyncState): TE.TaskEither<SyncError, { pushed: number; pulled: number }> => {
  if (state.syncInProgress) {
    return TE.left(new SyncError('Sync already in progress'));
  }
  
  return pipe(
    state.syncWorker,
    O.fold(
      () => TE.left(new SyncError('Sync not configured. Please provide MotherDuck token.')),
      (worker) => pipe(
        TE.Do,
        TE.tap(() => TE.fromIO(emit(state)('sync-start')())),
        TE.bind('pendingChanges', () => getPendingChanges(state)),
        TE.bind('schemas', () => getTableSchemas(state)),
        TE.chain(({ pendingChanges, schemas }) => {
          if (pendingChanges.length === 0) {
            emit(state)('sync-complete')({ changes: 0 })();
            return TE.of({ pushed: 0, pulled: 0 });
          }
          
          return pipe(
            sendToWorker(worker)({
              type: 'SYNC',
              changes: pendingChanges,
              schemas
            }),
            TE.chain((result) =>
              pipe(
                markChangesSynced(state)(pendingChanges),
                TE.chain(() => 
                  result.pulled && result.pulled.length > 0
                    ? applyPulledChanges(state)(result.pulled)
                    : TE.of(undefined)
                ),
                TE.map(() => ({
                  pushed: pendingChanges.length,
                  pulled: result.pulled ? result.pulled.length : 0
                }))
              )
            ),
            TE.chainFirst((result) => TE.fromIO(emit(state)('sync-complete')(result)()))
          );
        }),
        TE.mapLeft((error) => {
          emit(state)('sync-error')(error)();
          return error;
        })
      )
    )
  );
};

// Auto sync management
export const startAutoSync = (state: SyncState): IO.IO<SyncState> => () => {
  if (O.isSome(state.syncInterval)) {
    clearInterval(state.syncInterval.value);
  }
  
  const interval = setInterval(() => {
    if (navigator.onLine) {
      sync(state)().catch(console.error);
    }
  }, state.config.syncInterval);
  
  return { ...state, syncInterval: O.some(interval) };
};

export const stopAutoSync = (state: SyncState): IO.IO<SyncState> => () => {
  if (O.isSome(state.syncInterval)) {
    clearInterval(state.syncInterval.value);
  }
  
  return { ...state, syncInterval: O.none };
};

// Cleanup
export const destroy = (state: SyncState): TE.TaskEither<SyncError, void> =>
  pipe(
    TE.fromIO(stopAutoSync(state)),
    TE.chain(() =>
      pipe(
        state.syncWorker,
        O.fold(
          () => TE.of(undefined),
          (worker) => TE.fromIO(() => worker.terminate())
        )
      )
    ),
    TE.chain(() =>
      pipe(
        state.connection,
        O.fold(
          () => TE.of(undefined),
          ({ conn, db }) => TE.tryCatch(
            async () => {
              await conn.close();
              await db.terminate();
            },
            (error): SyncError => new SyncError(`Cleanup failed: ${error}`)
          )
        )
      )
    )
  );

// Helper function to create and initialize sync
export const createSync = (config: Partial<SyncConfig> = {}): TE.TaskEither<SyncError, SyncState> => {
  const state = createInitialState(config);
  return initialize(state);
};