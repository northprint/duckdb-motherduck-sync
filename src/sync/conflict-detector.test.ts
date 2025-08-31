/**
 * Tests for conflict detector
 */

import { describe, it, expect } from 'vitest';
import { pipe } from 'fp-ts/function';
import {
  recordsConflict,
  detectConflicts,
  createConflictDetector,
} from './conflict-detector';
import type { Change } from '../types';

describe('Conflict Detector', () => {
  describe('recordsConflict', () => {
    it('should detect conflicts in field values', () => {
      const local = { id: '1', name: 'Alice', age: 30 };
      const remote = { id: '1', name: 'Alice', age: 31 };

      expect(recordsConflict(local, remote)).toBe(true);
    });

    it('should not detect conflicts for identical records', () => {
      const local = { id: '1', name: 'Alice', age: 30 };
      const remote = { id: '1', name: 'Alice', age: 30 };

      expect(recordsConflict(local, remote)).toBe(false);
    });

    it('should detect conflicts with different keys', () => {
      const local = { id: '1', name: 'Alice' };
      const remote = { id: '1', name: 'Alice', email: 'alice@example.com' };

      expect(recordsConflict(local, remote)).toBe(true);
    });

    it('should ignore sync metadata fields', () => {
      const local = { id: '1', name: 'Alice', _sync_timestamp: 1000 };
      const remote = { id: '1', name: 'Alice', _sync_timestamp: 2000 };

      expect(recordsConflict(local, remote)).toBe(false);
    });

    it('should use timestamp tolerance when enabled', () => {
      const local = { id: '1', name: 'Alice', age: 30, _sync_timestamp: 1000 };
      const remote = { id: '1', name: 'Alice', age: 31, _sync_timestamp: 1500 };

      // Within tolerance
      expect(recordsConflict(local, remote, {
        considerTimestamp: true,
        timestampTolerance: 1000,
      })).toBe(false);

      // Outside tolerance
      expect(recordsConflict(local, remote, {
        considerTimestamp: true,
        timestampTolerance: 100,
      })).toBe(true);
    });
  });

  describe('detectConflicts', () => {
    it('should detect update conflicts', () => {
      const localChanges: Change[] = [{
        id: 'local1',
        table: 'users',
        operation: 'UPDATE',
        data: { id: '1', name: 'Alice Local' },
        timestamp: 1000,
      }];

      const remoteChanges: Change[] = [{
        id: 'remote1',
        table: 'users',
        operation: 'UPDATE',
        data: { id: '1', name: 'Alice Remote' },
        timestamp: 2000,
      }];

      const conflicts = detectConflicts(localChanges, remoteChanges);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]?.table).toBe('users');
      expect(conflicts[0]?.recordId).toBe('1');
      expect(conflicts[0]?.localVersion.name).toBe('Alice Local');
      expect(conflicts[0]?.remoteVersion.name).toBe('Alice Remote');
    });

    it('should detect update-delete conflicts', () => {
      const localChanges: Change[] = [{
        id: 'local1',
        table: 'users',
        operation: 'UPDATE',
        data: { id: '1', name: 'Alice Updated' },
        timestamp: 1000,
      }];

      const remoteChanges: Change[] = [{
        id: 'remote1',
        table: 'users',
        operation: 'DELETE',
        data: {},
        oldData: { id: '1', name: 'Alice' },
        timestamp: 2000,
      }];

      const conflicts = detectConflicts(localChanges, remoteChanges);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]?.recordId).toBe('1');
      expect(conflicts[0]?.remoteVersion).toEqual({});
    });

    it('should detect delete-update conflicts', () => {
      const localChanges: Change[] = [{
        id: 'local1',
        table: 'users',
        operation: 'DELETE',
        data: {},
        oldData: { id: '1', name: 'Alice' },
        timestamp: 1000,
      }];

      const remoteChanges: Change[] = [{
        id: 'remote1',
        table: 'users',
        operation: 'UPDATE',
        data: { id: '1', name: 'Alice Updated' },
        timestamp: 2000,
      }];

      const conflicts = detectConflicts(localChanges, remoteChanges);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]?.recordId).toBe('1');
      expect(conflicts[0]?.localVersion).toEqual({});
    });

    it('should not detect conflicts for different records', () => {
      const localChanges: Change[] = [{
        id: 'local1',
        table: 'users',
        operation: 'UPDATE',
        data: { id: '1', name: 'Alice' },
        timestamp: 1000,
      }];

      const remoteChanges: Change[] = [{
        id: 'remote1',
        table: 'users',
        operation: 'UPDATE',
        data: { id: '2', name: 'Bob' },
        timestamp: 2000,
      }];

      const conflicts = detectConflicts(localChanges, remoteChanges);

      expect(conflicts).toHaveLength(0);
    });

    it('should handle changes without IDs', () => {
      const localChanges: Change[] = [{
        id: 'local1',
        table: 'logs',
        operation: 'INSERT',
        data: { message: 'Log entry' }, // No ID
        timestamp: 1000,
      }];

      const remoteChanges: Change[] = [{
        id: 'remote1',
        table: 'logs',
        operation: 'INSERT',
        data: { message: 'Another log' }, // No ID
        timestamp: 2000,
      }];

      const conflicts = detectConflicts(localChanges, remoteChanges);

      expect(conflicts).toHaveLength(0);
    });
  });

  describe('createConflictDetector', () => {
    it('should create detector with task interface', async () => {
      const detector = createConflictDetector();

      const localChanges: Change[] = [{
        id: 'local1',
        table: 'users',
        operation: 'UPDATE',
        data: { id: '1', name: 'Alice Local' },
        timestamp: 1000,
      }];

      const remoteChanges: Change[] = [{
        id: 'remote1',
        table: 'users',
        operation: 'UPDATE',
        data: { id: '1', name: 'Alice Remote' },
        timestamp: 2000,
      }];

      const result = await pipe(
        detector.detect(localChanges, remoteChanges),
      )();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(1);
      }
    });
  });
});