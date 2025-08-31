/**
 * DuckDB-MotherDuck Sync Middleware
 * 
 * Main entry point for the sync library
 */

export const version = '0.1.0';

// Export types
export * from './types';
export * from './errors';

// Export sync functionality
export * from './sync';

// Export adapters
export * from './adapters';

// Export core components
export * from './core';

// Export utilities
export * from './utils';

// Export configuration
export * from './config/production';

// Re-export main factory functions for convenience
export { createSyncEngine } from './sync/engine';
export { createSimpleSyncEngine } from './sync/engine-simple';
export { createDuckDBAdapter } from './adapters/duckdb';
export { createMotherDuckClient } from './adapters/motherduck';
export { createNetworkMonitor } from './core/network-monitor';
export { createChangeTracker } from './core/change-tracker';
export { createDuckDBChangeTracker } from './core/change-tracker-duckdb';
export { createIndexedDBAdapter, createMemoryAdapter } from './adapters/storage';