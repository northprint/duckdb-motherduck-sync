/**
 * Tests for conflict resolver
 */

import { describe, it, expect } from 'vitest';
import * as E from 'fp-ts/Either';
import {
  detectConflicts,
  resolveConflict,
  resolveConflicts,
  mergeByFields,
  mergeArrays,
} from './conflict-resolver';
import type { Change, Conflict, ConflictStrategy } from '../types';

describe('Conflict Resolver', () => {
  const createChange = (
    table: string,
    id: string,
    data: Record<string, unknown>,
    timestamp: number,
    operation: 'INSERT' | 'UPDATE' | 'DELETE' = 'UPDATE',
  ): Change => ({
    id: `change-${id}`,
    table,
    operation,
    timestamp,
    data: { id, ...data },
  });

  describe('detectConflicts', () => {
    it('should detect conflicts for same record with different values', () => {
      const localChanges: Change[] = [
        createChange('users', '1', { name: 'Alice Local' }, 1000),
      ];

      const remoteChanges: Change[] = [
        createChange('users', '1', { name: 'Alice Remote' }, 2000),
      ];

      const conflicts = detectConflicts(localChanges, remoteChanges);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        table: 'users',
        key: { id: '1' },
        localValue: { id: '1', name: 'Alice Local' },
        remoteValue: { id: '1', name: 'Alice Remote' },
      });
    });

    it('should not detect conflicts for same values', () => {
      const localChanges: Change[] = [
        createChange('users', '1', { name: 'Alice' }, 1000),
      ];

      const remoteChanges: Change[] = [
        createChange('users', '1', { name: 'Alice' }, 2000),
      ];

      const conflicts = detectConflicts(localChanges, remoteChanges);

      expect(conflicts).toHaveLength(0);
    });

    it('should detect delete conflicts', () => {
      const localChanges: Change[] = [
        createChange('users', '1', { name: 'Alice' }, 1000, 'DELETE'),
      ];

      const remoteChanges: Change[] = [
        createChange('users', '1', { name: 'Alice Updated' }, 2000, 'UPDATE'),
      ];

      const conflicts = detectConflicts(localChanges, remoteChanges);

      expect(conflicts).toHaveLength(1);
    });

    it('should handle multiple tables', () => {
      const localChanges: Change[] = [
        createChange('users', '1', { name: 'Alice Local' }, 1000),
        createChange('products', '1', { price: 100 }, 1000),
      ];

      const remoteChanges: Change[] = [
        createChange('users', '1', { name: 'Alice Remote' }, 2000),
        createChange('products', '1', { price: 150 }, 2000),
      ];

      const conflicts = detectConflicts(localChanges, remoteChanges);

      expect(conflicts).toHaveLength(2);
      expect(conflicts.map(c => c.table).sort()).toEqual(['products', 'users']);
    });

    it('should use latest change when multiple changes for same record', () => {
      const localChanges: Change[] = [
        createChange('users', '1', { name: 'Alice v1' }, 1000),
        createChange('users', '1', { name: 'Alice v2' }, 3000),
      ];

      const remoteChanges: Change[] = [
        createChange('users', '1', { name: 'Alice Remote' }, 2000),
      ];

      const conflicts = detectConflicts(localChanges, remoteChanges);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]?.localValue).toMatchObject({ name: 'Alice v2' });
    });
  });

  describe('resolveConflict', () => {
    const conflict: Conflict = {
      table: 'users',
      key: { id: '1' },
      localValue: { id: '1', name: 'Local', updated: 1000 },
      remoteValue: { id: '1', name: 'Remote', updated: 2000 },
      localTimestamp: 1000,
      remoteTimestamp: 2000,
    };

    it('should resolve with local-wins strategy', () => {
      const strategy: ConflictStrategy = { type: 'local-wins' };
      const result = resolveConflict(conflict, strategy);

      expect(E.isRight(result)).toBe(true);
      if (E.isRight(result)) {
        expect(result.right).toEqual(conflict.localValue);
      }
    });

    it('should resolve with remote-wins strategy', () => {
      const strategy: ConflictStrategy = { type: 'remote-wins' };
      const result = resolveConflict(conflict, strategy);

      expect(E.isRight(result)).toBe(true);
      if (E.isRight(result)) {
        expect(result.right).toEqual(conflict.remoteValue);
      }
    });

    it('should resolve with latest-wins strategy', () => {
      const strategy: ConflictStrategy = { type: 'latest-wins' };
      const result = resolveConflict(conflict, strategy);

      expect(E.isRight(result)).toBe(true);
      if (E.isRight(result)) {
        expect(result.right).toEqual(conflict.remoteValue); // Remote has later timestamp
      }
    });

    it('should resolve with latest-wins favoring local when newer', () => {
      const newerLocalConflict: Conflict = {
        ...conflict,
        localTimestamp: 3000,
      };

      const strategy: ConflictStrategy = { type: 'latest-wins' };
      const result = resolveConflict(newerLocalConflict, strategy);

      expect(E.isRight(result)).toBe(true);
      if (E.isRight(result)) {
        expect(result.right).toEqual(newerLocalConflict.localValue);
      }
    });

    it('should return error for manual strategy', () => {
      const strategy: ConflictStrategy = { type: 'manual' };
      const result = resolveConflict(conflict, strategy);

      expect(E.isLeft(result)).toBe(true);
      if (E.isLeft(result)) {
        expect(result.left.message).toContain('Manual conflict resolution required');
      }
    });
  });

  describe('resolveConflicts', () => {
    it('should resolve multiple conflicts', () => {
      const conflicts: Conflict[] = [
        {
          table: 'users',
          key: { id: '1' },
          localValue: { id: '1', name: 'Local 1' },
          remoteValue: { id: '1', name: 'Remote 1' },
          localTimestamp: 1000,
          remoteTimestamp: 2000,
        },
        {
          table: 'users',
          key: { id: '2' },
          localValue: { id: '2', name: 'Local 2' },
          remoteValue: { id: '2', name: 'Remote 2' },
          localTimestamp: 3000,
          remoteTimestamp: 2500,
        },
      ];

      const strategy: ConflictStrategy = { type: 'latest-wins' };
      const result = resolveConflicts(conflicts, strategy);

      expect(E.isRight(result)).toBe(true);
      if (E.isRight(result)) {
        expect(result.right).toHaveLength(2);
        expect(result.right[0]?.resolution).toEqual(conflicts[0]?.remoteValue);
        expect(result.right[1]?.resolution).toEqual(conflicts[1]?.localValue);
      }
    });

    it('should fail if any conflict fails to resolve', () => {
      const conflicts: Conflict[] = [
        {
          table: 'users',
          key: { id: '1' },
          localValue: { id: '1', name: 'Local' },
          remoteValue: { id: '1', name: 'Remote' },
          localTimestamp: 1000,
          remoteTimestamp: 2000,
        },
      ];

      const strategy: ConflictStrategy = { type: 'manual' };
      const result = resolveConflicts(conflicts, strategy);

      expect(E.isLeft(result)).toBe(true);
    });
  });

  describe('merge functions', () => {
    describe('mergeByFields', () => {
      it('should prefer non-null values', () => {
        const local = { id: '1', name: 'Alice', email: null };
        const remote = { id: '1', name: null, email: 'alice@example.com' };

        const result = mergeByFields(local, remote, undefined);

        expect(E.isRight(result)).toBe(true);
        if (E.isRight(result)) {
          expect(result.right).toEqual({
            id: '1',
            name: 'Alice',
            email: 'alice@example.com',
          });
        }
      });

      it('should include all fields from both records', () => {
        const local = { id: '1', name: 'Alice' };
        const remote = { id: '1', email: 'alice@example.com' };

        const result = mergeByFields(local, remote, undefined);

        expect(E.isRight(result)).toBe(true);
        if (E.isRight(result)) {
          expect(result.right).toEqual({
            id: '1',
            name: 'Alice',
            email: 'alice@example.com',
          });
        }
      });
    });

    describe('mergeArrays', () => {
      it('should concatenate and deduplicate arrays', () => {
        const local = { id: '1', tags: ['a', 'b'] };
        const remote = { id: '1', tags: ['b', 'c'] };

        const result = mergeArrays(local, remote, undefined);

        expect(E.isRight(result)).toBe(true);
        if (E.isRight(result)) {
          expect(result.right).toEqual({
            id: '1',
            tags: ['a', 'b', 'c'],
          });
        }
      });

      it('should handle non-array fields normally', () => {
        const local = { id: '1', name: 'Alice', tags: ['a'] };
        const remote = { id: '1', name: 'Alice Updated', tags: ['b'] };

        const result = mergeArrays(local, remote, undefined);

        expect(E.isRight(result)).toBe(true);
        if (E.isRight(result)) {
          expect(result.right).toEqual({
            id: '1',
            name: 'Alice Updated',
            tags: ['a', 'b'],
          });
        }
      });
    });
  });
});