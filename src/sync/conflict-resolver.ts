/**
 * Conflict resolution logic
 */

import { pipe } from 'fp-ts/function';
import * as E from 'fp-ts/Either';
import * as A from 'fp-ts/Array';
import type { Either } from 'fp-ts/Either';
import type {
  Conflict,
  ConflictStrategy,
  Change,
  DbRecord,
  MergeFunction,
} from '../types';

// Type definitions
export type ConflictResolver = (
  conflict: Conflict,
  strategy: ConflictStrategy
) => Either<Error, DbRecord>;

export interface ConflictResolution {
  conflict: Conflict;
  resolution: DbRecord;
}

// Detect conflicts between local and remote changes
export const detectConflicts = (
  localChanges: ReadonlyArray<Change>,
  remoteChanges: ReadonlyArray<Change>,
): ReadonlyArray<Conflict> => {
  // Group changes by table and key
  const groupByTableAndKey = (changes: ReadonlyArray<Change>): Map<string, Change> => {
    const grouped = new Map<string, Change>();
    
    changes.forEach((change) => {
      // Use primary key fields or all fields as key
      const keyFields = extractKeyFields(change.data);
      const key = `${change.table}:${JSON.stringify(keyFields)}`;
      
      // Keep the latest change for each key
      const existing = grouped.get(key);
      if (!existing || change.timestamp > existing.timestamp) {
        grouped.set(key, change);
      }
    });
    
    return grouped;
  };

  const localMap = groupByTableAndKey(localChanges);
  const remoteMap = groupByTableAndKey(remoteChanges);

  const conflicts: Conflict[] = [];

  // Check for conflicts
  localMap.forEach((localChange, key) => {
    const remoteChange = remoteMap.get(key);
    
    if (remoteChange && hasConflict(localChange, remoteChange)) {
      conflicts.push({
        table: localChange.table,
        key: extractKeyFields(localChange.data),
        localValue: localChange.data,
        remoteValue: remoteChange.data,
        localTimestamp: localChange.timestamp,
        remoteTimestamp: remoteChange.timestamp,
      });
    }
  });

  return conflicts;
};

// Extract key fields from a record (simplified - in real implementation would use table schema)
const extractKeyFields = (record: DbRecord): DbRecord => {
  // Look for common primary key field names
  const keyFieldNames = ['id', '_id', 'uuid', 'key'];
  const keyFields: Record<string, unknown> = {};

  keyFieldNames.forEach((fieldName) => {
    if (fieldName in record) {
      keyFields[fieldName] = record[fieldName];
    }
  });

  // If no key fields found, use all fields
  return Object.keys(keyFields).length > 0 ? keyFields as DbRecord : record;
};

// Check if two changes have a conflict
const hasConflict = (local: Change, remote: Change): boolean => {
  // No conflict if one is DELETE and the other is not
  if (local.operation === 'DELETE' || remote.operation === 'DELETE') {
    return local.operation !== remote.operation;
  }

  // Conflict if both modified the same record
  return !isEqual(local.data, remote.data);
};

// Deep equality check for records
const isEqual = (a: DbRecord, b: DbRecord): boolean => {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  return keysA.every((key) => {
    const valueA = a[key];
    const valueB = b[key];

    if (valueA instanceof Date && valueB instanceof Date) {
      return valueA.getTime() === valueB.getTime();
    }

    if (valueA instanceof Uint8Array && valueB instanceof Uint8Array) {
      return valueA.length === valueB.length &&
        valueA.every((byte, i) => byte === valueB[i]);
    }

    return valueA === valueB;
  });
};

// Resolve a single conflict based on strategy
export const resolveConflict = (
  conflict: Conflict,
  strategy: ConflictStrategy,
): Either<Error, DbRecord> => {
  switch (strategy.type) {
    case 'local-wins':
      return E.right(conflict.localValue);

    case 'remote-wins':
      return E.right(conflict.remoteValue);

    case 'latest-wins':
      return E.right(
        conflict.localTimestamp > conflict.remoteTimestamp
          ? conflict.localValue
          : conflict.remoteValue
      );

    case 'merge':
      return strategy.mergeFunction(
        conflict.localValue,
        conflict.remoteValue,
      );

    case 'manual':
      return E.left(
        new Error(`Manual conflict resolution required for ${conflict.table}`),
      );

    default:
      return E.left(new Error(`Unknown conflict strategy: ${(strategy as any).type}`));
  }
};

// Resolve multiple conflicts
export const resolveConflicts = (
  conflicts: ReadonlyArray<Conflict>,
  strategy: ConflictStrategy,
): Either<Error, ReadonlyArray<{ conflict: Conflict; resolution: DbRecord }>> => {
  return pipe(
    Array.from(conflicts),
    A.traverse(E.Applicative)((conflict) =>
      pipe(
        resolveConflict(conflict, strategy),
        E.map((resolution) => ({ conflict, resolution })),
      ),
    ),
  );
};

// Built-in merge functions

// Merge by combining fields (prefer non-null values)
export const mergeByFields: MergeFunction = (local, remote) => {
  const merged: Record<string, unknown> = {};

  // Get all unique keys
  const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);

  allKeys.forEach((key) => {
    const localValue = local[key];
    const remoteValue = remote[key];

    // Prefer non-null values
    if (localValue === null || localValue === undefined) {
      merged[key] = remoteValue;
    } else if (remoteValue === null || remoteValue === undefined) {
      merged[key] = localValue;
    } else {
      // Both have values - use latest based on simple heuristic
      // In real implementation, would use field-level timestamps
      merged[key] = remoteValue;
    }
  });

  return E.right(merged as DbRecord);
};

// Merge arrays by concatenating and deduplicating
export const mergeArrays: MergeFunction = (local, remote) => {
  const merged: Record<string, unknown> = {};

  const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);

  allKeys.forEach((key) => {
    const localValue = local[key];
    const remoteValue = remote[key];

    if (Array.isArray(localValue) && Array.isArray(remoteValue)) {
      // Merge arrays by concatenating and deduplicating
      const combined = [...localValue, ...remoteValue];
      merged[key] = Array.from(new Set(combined.map((item) => JSON.stringify(item)))).map((str) => JSON.parse(str) as unknown);
    } else {
      // Use merge by fields for non-array values
      merged[key] = remoteValue ?? localValue;
    }
  });

  return E.right(merged as DbRecord);
};

// Create custom merge strategy
export const createMergeStrategy = (
  mergeFunction: MergeFunction,
): ConflictStrategy => ({
  type: 'merge',
  mergeFunction,
});