/**
 * Table filtering for selective sync
 */

import { pipe } from 'fp-ts/function';
import * as A from 'fp-ts/Array';
import type { Change } from '../types';

// Table filter configuration
export interface TableFilterConfig {
  readonly includeTables?: ReadonlyArray<string>;
  readonly excludeTables?: ReadonlyArray<string>;
  readonly includePatterns?: ReadonlyArray<RegExp>;
  readonly excludePatterns?: ReadonlyArray<RegExp>;
}

// Create table filter
export const createTableFilter = (
  config: TableFilterConfig,
): ((table: string) => boolean) => {
  const {
    includeTables = [],
    excludeTables = [],
    includePatterns = [],
    excludePatterns = [],
  } = config;

  return (table: string): boolean => {
    // Check explicit excludes first
    if (excludeTables.includes(table)) {
      return false;
    }

    // Check exclude patterns
    if (excludePatterns.some(pattern => pattern.test(table))) {
      return false;
    }

    // If include lists are empty, include by default
    if (includeTables.length === 0 && includePatterns.length === 0) {
      return true;
    }

    // Check explicit includes
    if (includeTables.includes(table)) {
      return true;
    }

    // Check include patterns
    if (includePatterns.some(pattern => pattern.test(table))) {
      return true;
    }

    // Not in include list
    return false;
  };
};

// Filter changes by table
export const filterChangesByTable = (
  changes: ReadonlyArray<Change>,
  filter: (table: string) => boolean,
): ReadonlyArray<Change> =>
  pipe(
    changes,
    A.filter((change: Change) => filter(change.table)) as (changes: ReadonlyArray<Change>) => Change[],
  );

// Create default filters for common scenarios
export const commonFilters = {
  // Exclude system tables
  excludeSystemTables: (): TableFilterConfig => ({
    excludePatterns: [
      /^_/, // Tables starting with underscore
      /^sys_/, // System tables
      /^pg_/, // PostgreSQL system tables
      /^information_schema/, // Information schema
    ],
  }),

  // Only sync specific tables
  onlyTables: (...tables: string[]): TableFilterConfig => ({
    includeTables: tables,
  }),

  // Exclude specific tables
  exceptTables: (...tables: string[]): TableFilterConfig => ({
    excludeTables: tables,
  }),

  // Sync tables matching pattern
  matchingPattern: (pattern: RegExp): TableFilterConfig => ({
    includePatterns: [pattern],
  }),

  // Combine multiple filters
  combine: (...configs: TableFilterConfig[]): TableFilterConfig => ({
    includeTables: configs.flatMap(c => c.includeTables || []),
    excludeTables: configs.flatMap(c => c.excludeTables || []),
    includePatterns: configs.flatMap(c => c.includePatterns || []),
    excludePatterns: configs.flatMap(c => c.excludePatterns || []),
  }),
};

// Table metadata for filtering decisions
export interface TableMetadata {
  readonly name: string;
  readonly rowCount?: number;
  readonly sizeBytes?: number;
  readonly lastModified?: number;
}

// Filter tables by metadata
export const filterTablesByMetadata = (
  tables: ReadonlyArray<TableMetadata>,
  predicate: (metadata: TableMetadata) => boolean,
): ReadonlyArray<string> =>
  pipe(
    tables,
    A.filter(predicate) as (tables: ReadonlyArray<TableMetadata>) => TableMetadata[],
    A.map((t: TableMetadata) => t.name),
  );

// Common metadata filters
export const metadataFilters = {
  // Only sync small tables
  smallTables: (maxRows: number): ((metadata: TableMetadata) => boolean) =>
    (metadata) => (metadata.rowCount || 0) <= maxRows,

  // Only sync recently modified tables
  recentlyModified: (sinceMs: number): ((metadata: TableMetadata) => boolean) =>
    (metadata) => (metadata.lastModified || 0) >= sinceMs,

  // Only sync tables within size limit
  withinSizeLimit: (maxSizeMB: number): ((metadata: TableMetadata) => boolean) =>
    (metadata) => (metadata.sizeBytes || 0) <= maxSizeMB * 1024 * 1024,
};