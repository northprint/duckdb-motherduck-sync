/**
 * Production configuration for DuckDB-MotherDuck sync
 */

import type { SyncConfig } from '../types';

export interface ProductionConfig {
  readonly motherduck: {
    readonly tokenEnvVar: string;
    readonly defaultDatabase?: string;
    readonly connectionTimeout?: number;
  };
  readonly sync: {
    readonly defaultInterval: number;
    readonly maxBatchSize: number;
    readonly compressionEnabled: boolean;
    readonly retryAttempts: number;
    readonly retryDelay: number;
  };
  readonly security: {
    readonly requireHttps: boolean;
    readonly allowedOrigins?: string[];
    readonly corsEnabled: boolean;
  };
  readonly monitoring: {
    readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
    readonly metricsEnabled: boolean;
    readonly errorReporting: boolean;
  };
}

export const defaultProductionConfig: ProductionConfig = {
  motherduck: {
    tokenEnvVar: 'MOTHERDUCK_TOKEN',
    connectionTimeout: 30000, // 30 seconds
  },
  sync: {
    defaultInterval: 300000, // 5 minutes
    maxBatchSize: 1000,
    compressionEnabled: true,
    retryAttempts: 3,
    retryDelay: 1000, // 1 second
  },
  security: {
    requireHttps: true,
    corsEnabled: true,
    allowedOrigins: ['https://app.motherduck.com'],
  },
  monitoring: {
    logLevel: 'info',
    metricsEnabled: true,
    errorReporting: true,
  },
};

/**
 * Get MotherDuck token from environment
 * In production, never hardcode tokens
 */
export const getMotherDuckToken = (config: ProductionConfig): string => {
  const token = process.env[config.motherduck.tokenEnvVar];
  
  if (!token) {
    throw new Error(
      `MotherDuck token not found. Please set ${config.motherduck.tokenEnvVar} environment variable.`
    );
  }
  
  // Basic validation
  if (!token.startsWith('eyJ')) {
    throw new Error('Invalid MotherDuck token format');
  }
  
  return token;
};

/**
 * Create production sync configuration
 */
export const createProductionSyncConfig = (
  tables: string[],
  config: ProductionConfig = defaultProductionConfig,
): SyncConfig => {
  const token = getMotherDuckToken(config);
  
  return {
    motherduckToken: token,
    tables,
    syncInterval: config.sync.defaultInterval,
    conflictStrategy: 'latest-wins',
    enableCompression: config.sync.compressionEnabled,
    batchSize: config.sync.maxBatchSize,
    maxRetries: config.sync.retryAttempts,
    retryDelay: config.sync.retryDelay,
  };
};