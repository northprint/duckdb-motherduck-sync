/**
 * DuckDB-MotherDuck Sync Library
 * 
 * Main entry point with both functional and class-based APIs
 */

import * as O from 'fp-ts/Option';
import { pipe } from 'fp-ts/function';
import * as functional from './duckdb-sync-functional';
import type { SyncConfig } from './duckdb-sync-functional';

// Re-export functional API
export * from './duckdb-sync-functional';

// Export version
export const version = '0.1.0';

// Helper function to convert config
const convertConfig = (config: any = {}): Partial<SyncConfig> => ({
  ...config,
  motherduckToken: config.motherduckToken ? O.some(config.motherduckToken) : O.none,
});

// Simplified API wrapper for easier usage
export const DuckDBSync = {
  /**
   * Create and initialize a sync instance
   * @param config - Configuration object
   * @param config.motherduckToken - MotherDuck authentication token
   * @param config.syncInterval - Auto-sync interval in milliseconds (default: 30000)
   * @param config.autoSync - Enable auto-sync (default: true)
   * @param config.syncWorkerPath - Path to sync worker (default: '/duckdb-sync-worker.js')
   * @returns Sync instance
   */
  create: async (config: Partial<SyncConfig> = {}) => {
    const functionalConfig = convertConfig(config);
    const stateTask = functional.createSync(functionalConfig);
    const result = await stateTask();
    
    if (result._tag === 'Left') {
      throw result.left;
    }
    
    const state = result.right;
    
    // Return simplified API
    return {
      /**
       * Track a table for sync
       * @param tableName - Name of the table to track
       * @param options - Tracking options
       * @returns Promise<void>
       */
      trackTable: async (tableName: string, options: { trackQuery?: string } = {}) => {
        const task = functional.trackTable(state)(tableName)(options);
        const trackResult = await task();
        if (trackResult._tag === 'Left') {
          throw trackResult.left;
        }
      },
      
      /**
       * Execute a query
       * @param sql - SQL query to execute
       * @param params - Query parameters
       * @returns Query results
       */
      query: async (sql: string, params: any[] = []) => {
        const task = functional.query(state)(sql)(params);
        const queryResult = await task();
        if (queryResult._tag === 'Left') {
          throw queryResult.left;
        }
        return queryResult.right;
      },
      
      /**
       * Sync with MotherDuck
       * @returns Sync results { pushed, pulled }
       */
      sync: async () => {
        const task = functional.sync(state);
        const syncResult = await task();
        if (syncResult._tag === 'Left') {
          throw syncResult.left;
        }
        return syncResult.right;
      },
      
      /**
       * Start auto-sync
       */
      startAutoSync: () => {
        const newState = functional.startAutoSync(state)();
        Object.assign(state, newState);
      },
      
      /**
       * Stop auto-sync
       */
      stopAutoSync: () => {
        const newState = functional.stopAutoSync(state)();
        Object.assign(state, newState);
      },
      
      /**
       * Add event listener
       * @param event - Event name
       * @param callback - Event callback
       */
      on: (event: string, callback: (data?: any) => void) => {
        const newState = functional.on(state)(event)(callback)();
        Object.assign(state, newState);
      },
      
      /**
       * Remove event listener
       * @param event - Event name
       * @param callback - Event callback
       */
      off: (event: string, callback: (data?: any) => void) => {
        const newState = functional.off(state)(event)(callback)();
        Object.assign(state, newState);
      },
      
      /**
       * Get raw connection for direct queries
       * @returns DuckDB connection
       */
      getConnection: () => {
        return pipe(
          state.connection,
          O.fold(
            () => null,
            ({ conn }) => conn
          )
        );
      },
      
      /**
       * Cleanup and destroy
       */
      destroy: async () => {
        const task = functional.destroy(state);
        const destroyResult = await task();
        if (destroyResult._tag === 'Left') {
          throw destroyResult.left;
        }
      },
    };
  },
};

// For backward compatibility, also export the class-based API
export { DuckDBSync as DuckDBSyncClass } from './duckdb-sync';

// Export worker path helper
export const getDefaultWorkerPath = (): string => '/duckdb-sync-worker.js';

// Export types
export { SyncError } from './duckdb-sync-functional';