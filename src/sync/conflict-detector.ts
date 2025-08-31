/**
 * Conflict detection for sync operations
 */

import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import * as A from 'fp-ts/Array';
import * as O from 'fp-ts/Option';
import type { TaskEither } from 'fp-ts/TaskEither';
import type {
  Change,
  Conflict,
  DbRecord,
  SyncError,
} from '../types';
import { conflictError } from '../types/errors';

// Conflict detection options
export interface ConflictDetectionOptions {
  readonly considerTimestamp?: boolean;
  readonly timestampTolerance?: number; // ms
}

// Check if two records conflict
export const recordsConflict = (
  local: DbRecord,
  remote: DbRecord,
  options: ConflictDetectionOptions = {},
): boolean => {
  // If considerTimestamp is true, check if modifications happened within tolerance
  if (options.considerTimestamp) {
    const localTime = local['_sync_timestamp'] as number | undefined;
    const remoteTime = remote['_sync_timestamp'] as number | undefined;
    
    if (localTime && remoteTime) {
      const tolerance = options.timestampTolerance || 1000; // 1 second default
      if (Math.abs(localTime - remoteTime) < tolerance) {
        return false; // Considered same version
      }
    }
  }

  // Check if any fields differ (excluding sync metadata)
  const localKeys = Object.keys(local).filter(k => !k.startsWith('_sync_'));
  const remoteKeys = Object.keys(remote).filter(k => !k.startsWith('_sync_'));

  // Different keys means conflict
  if (localKeys.length !== remoteKeys.length) {
    return true;
  }

  // Check each field
  return localKeys.some(key => {
    const localValue = local[key];
    const remoteValue = remote[key];
    
    // Deep equality check would be better, but simple comparison for now
    return JSON.stringify(localValue) !== JSON.stringify(remoteValue);
  });
};

// Detect conflicts between local and remote changes
export const detectConflicts = (
  localChanges: ReadonlyArray<Change>,
  remoteChanges: ReadonlyArray<Change>,
  options: ConflictDetectionOptions = {},
): ReadonlyArray<Conflict> => {
  const conflicts: Conflict[] = [];
  
  // Group changes by table and record ID
  const localByKey = new Map<string, Change>();
  const remoteByKey = new Map<string, Change>();
  
  localChanges.forEach(change => {
    const recordId = change.data['id'] as string | undefined;
    if (recordId) {
      const key = `${change.table}:${recordId}`;
      localByKey.set(key, change);
    }
  });
  
  remoteChanges.forEach(change => {
    const recordId = change.data['id'] as string | undefined;
    if (recordId) {
      const key = `${change.table}:${recordId}`;
      remoteByKey.set(key, change);
    }
  });
  
  // Check for conflicts
  localByKey.forEach((localChange, key) => {
    const remoteChange = remoteByKey.get(key);
    
    if (remoteChange) {
      // Both modified the same record
      if (recordsConflict(localChange.data, remoteChange.data, options)) {
        conflicts.push({
          id: `conflict_${localChange.id}_${remoteChange.id}`,
          table: localChange.table,
          recordId: localChange.data['id'] as string,
          localVersion: localChange.data,
          remoteVersion: remoteChange.data,
          localTimestamp: localChange.timestamp,
          remoteTimestamp: remoteChange.timestamp,
          detectedAt: Date.now(),
        });
      }
    } else if (localChange.operation === 'UPDATE') {
      // Local update but record might be deleted remotely
      const remoteDelete = Array.from(remoteByKey.values()).find(
        change => 
          change.table === localChange.table &&
          change.operation === 'DELETE' &&
          change.oldData?.['id'] === localChange.data['id']
      );
      
      if (remoteDelete) {
        conflicts.push({
          id: `conflict_${localChange.id}_delete`,
          table: localChange.table,
          recordId: localChange.data['id'] as string,
          localVersion: localChange.data,
          remoteVersion: {}, // Deleted
          localTimestamp: localChange.timestamp,
          remoteTimestamp: remoteDelete.timestamp,
          detectedAt: Date.now(),
        });
      }
    }
  });
  
  // Check for delete conflicts
  remoteChanges.forEach(remoteChange => {
    if (remoteChange.operation === 'DELETE') {
      const recordId = remoteChange.oldData?.['id'] as string | undefined;
      if (recordId) {
        const localUpdate = Array.from(localByKey.values()).find(
          change => 
            change.table === remoteChange.table &&
            change.operation === 'UPDATE' &&
            change.data['id'] === recordId
        );
        
        if (localUpdate && !conflicts.some(c => c.recordId === recordId)) {
          conflicts.push({
            id: `conflict_delete_${localUpdate.id}`,
            table: remoteChange.table,
            recordId,
            localVersion: localUpdate.data,
            remoteVersion: {}, // Deleted
            localTimestamp: localUpdate.timestamp,
            remoteTimestamp: remoteChange.timestamp,
            detectedAt: Date.now(),
          });
        }
      }
    }
  });
  
  // Also check for local deletes vs remote updates
  localChanges.forEach(localChange => {
    if (localChange.operation === 'DELETE') {
      const recordId = localChange.oldData?.['id'] as string | undefined;
      if (recordId) {
        const remoteUpdate = Array.from(remoteByKey.values()).find(
          change => 
            change.table === localChange.table &&
            change.operation === 'UPDATE' &&
            change.data['id'] === recordId
        );
        
        if (remoteUpdate && !conflicts.some(c => c.recordId === recordId)) {
          conflicts.push({
            id: `conflict_${localChange.id}_${remoteUpdate.id}`,
            table: localChange.table,
            recordId,
            localVersion: {}, // Deleted
            remoteVersion: remoteUpdate.data,
            localTimestamp: localChange.timestamp,
            remoteTimestamp: remoteUpdate.timestamp,
            detectedAt: Date.now(),
          });
        }
      }
    }
  });
  
  return conflicts;
};

// Create conflict detection task
export const createConflictDetector = (
  options: ConflictDetectionOptions = {},
) => ({
  detect: (
    localChanges: ReadonlyArray<Change>,
    remoteChanges: ReadonlyArray<Change>,
  ): TaskEither<SyncError, ReadonlyArray<Conflict>> =>
    TE.tryCatch(
      async () => detectConflicts(localChanges, remoteChanges, options),
      (error) => conflictError(
        'Conflict detection failed',
        [],
        error instanceof Error ? error : new Error(String(error)),
      ),
    ),
});