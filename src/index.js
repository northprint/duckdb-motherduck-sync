/**
 * DuckDB-MotherDuck Sync Library
 * 
 * Main entry point with both functional and class-based APIs
 */

import * as O from 'fp-ts/Option';
import { pipe } from 'fp-ts/function';
import * as functional from './duckdb-sync-functional.js';

// Re-export functional API
export * from './duckdb-sync-functional.js';

// Helper function to convert config
const convertConfig = (config = {}) => ({
  ...config,
  motherduckToken: config.motherduckToken ? O.some(config.motherduckToken) : O.none,
});

// Simplified API wrapper for easier usage
export const DuckDBSync = {
  /**
   * Create and initialize a sync instance
   * @param {Object} config - Configuration object
   * @param {string} config.motherduckToken - MotherDuck authentication token
   * @param {number} config.syncInterval - Auto-sync interval in milliseconds (default: 30000)
   * @param {boolean} config.autoSync - Enable auto-sync (default: true)
   * @param {string} config.syncWorkerPath - Path to sync worker (default: '/duckdb-sync-worker.js')
   * @returns {Promise<Object>} Sync instance
   */
  create: async (config = {}) => {
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
       * @param {string} tableName - Name of the table to track
       * @param {Object} options - Tracking options
       * @returns {Promise<void>}
       */
      trackTable: async (tableName, options = {}) => {
        const task = functional.trackTable(state)(tableName)(options);
        const trackResult = await task();
        if (trackResult._tag === 'Left') {
          throw trackResult.left;
        }
      },
      
      /**
       * Execute a query
       * @param {string} sql - SQL query to execute
       * @param {Array} params - Query parameters
       * @returns {Promise<Array>} Query results
       */
      query: async (sql, params = []) => {
        const task = functional.query(state)(sql)(params);
        const queryResult = await task();
        if (queryResult._tag === 'Left') {
          throw queryResult.left;
        }
        return queryResult.right;
      },
      
      /**
       * Sync with MotherDuck
       * @returns {Promise<Object>} Sync results { pushed, pulled }
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
       * @returns {void}
       */
      startAutoSync: () => {
        const newState = functional.startAutoSync(state)();
        Object.assign(state, newState);
      },
      
      /**
       * Stop auto-sync
       * @returns {void}
       */
      stopAutoSync: () => {
        const newState = functional.stopAutoSync(state)();
        Object.assign(state, newState);
      },
      
      /**
       * Add event listener
       * @param {string} event - Event name
       * @param {Function} callback - Event callback
       * @returns {void}
       */
      on: (event, callback) => {
        const newState = functional.on(state)(event)(callback)();
        Object.assign(state, newState);
      },
      
      /**
       * Remove event listener
       * @param {string} event - Event name
       * @param {Function} callback - Event callback
       * @returns {void}
       */
      off: (event, callback) => {
        const newState = functional.off(state)(event)(callback)();
        Object.assign(state, newState);
      },
      
      /**
       * Get raw connection for direct queries
       * @returns {Object|null} DuckDB connection
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
       * @returns {Promise<void>}
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
export { DuckDBSync as DuckDBSyncClass } from './duckdb-sync.js';

// Export worker path helper
export const getDefaultWorkerPath = () => '/duckdb-sync-worker.js';

// Export types
export { SyncError } from './duckdb-sync-functional.js';