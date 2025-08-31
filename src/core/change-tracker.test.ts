/**
 * Tests for change tracker
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { pipe } from 'fp-ts/function';
import { createMemoryChangeTracker } from './change-tracker';
import type { Change } from '../types';

describe('Change Tracker', () => {
  describe('Memory Tracker', () => {
    let tracker: ReturnType<typeof createMemoryChangeTracker>;

    beforeEach(() => {
      tracker = createMemoryChangeTracker();
    });

    it('should record changes with generated id and timestamp', async () => {
      const changeData = {
        table: 'users',
        operation: 'INSERT' as const,
        data: { name: 'Alice', email: 'alice@example.com' },
      };

      const result = await pipe(tracker.recordChange(changeData))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        const change = result.right;
        expect(change.id).toMatch(/^[0-9a-f-]+$/); // UUID format
        expect(change.table).toBe('users');
        expect(change.operation).toBe('INSERT');
        expect(change.timestamp).toBeGreaterThan(0);
        expect(change.data).toEqual(changeData.data);
      }
    });

    it('should get unsynced changes', async () => {
      // Record multiple changes
      await pipe(tracker.recordChange({
        table: 'users',
        operation: 'INSERT',
        data: { id: '1' },
      }))();

      await pipe(tracker.recordChange({
        table: 'users',
        operation: 'UPDATE',
        data: { id: '1', name: 'Updated' },
        oldData: { id: '1' },
      }))();

      const result = await pipe(tracker.getUnsyncedChanges())();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(2);
        expect(result.right[0]?.operation).toBe('INSERT');
        expect(result.right[1]?.operation).toBe('UPDATE');
      }
    });

    it('should filter changes by timestamp', async () => {
      const beforeTimestamp = Date.now();

      await pipe(tracker.recordChange({
        table: 'old',
        operation: 'INSERT',
        data: { id: 'old' },
      }))();

      await new Promise(resolve => setTimeout(resolve, 10)); // Wait a bit

      const afterTimestamp = Date.now();

      await pipe(tracker.recordChange({
        table: 'new',
        operation: 'INSERT',
        data: { id: 'new' },
      }))();

      const result = await pipe(tracker.getUnsyncedChanges(afterTimestamp - 1))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(1);
        expect(result.right[0]?.data.id).toBe('new');
      }
    });

    it('should mark changes as synced', async () => {
      // Record changes
      const change1Result = await pipe(tracker.recordChange({
        table: 'users',
        operation: 'INSERT',
        data: { id: '1' },
      }))();

      const change2Result = await pipe(tracker.recordChange({
        table: 'users',
        operation: 'INSERT',
        data: { id: '2' },
      }))();

      if (change1Result._tag !== 'Right' || change2Result._tag !== 'Right') {
        throw new Error('Failed to record changes');
      }

      const change1Id = change1Result.right.id;
      const change2Id = change2Result.right.id;

      // Mark first change as synced
      await pipe(tracker.markSynced([change1Id]))();

      // Get unsynced changes
      const result = await pipe(tracker.getUnsyncedChanges())();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(1);
        expect(result.right[0]?.id).toBe(change2Id);
      }
    });

    it('should handle empty changeIds array', async () => {
      const result = await pipe(tracker.markSynced([]))();
      expect(result._tag).toBe('Right');
    });

    it('should clear old synced history', async () => {
      const now = Date.now();

      // Record old change
      const oldChangeResult = await pipe(tracker.recordChange({
        table: 'old',
        operation: 'INSERT',
        data: { id: 'old' },
      }))();

      if (oldChangeResult._tag !== 'Right') {
        throw new Error('Failed to record change');
      }

      // Mark as synced
      await pipe(tracker.markSynced([oldChangeResult.right.id]))();

      // Record new change
      await pipe(tracker.recordChange({
        table: 'new',
        operation: 'INSERT',
        data: { id: 'new' },
      }))();

      // Clear history before current time
      await pipe(tracker.clearHistory(now + 1000))();

      // Check all changes
      const allChanges = tracker.getChanges();
      expect(allChanges).toHaveLength(1);
      expect(allChanges[0]?.data.id).toBe('new');
    });

    it('should preserve unsynced changes when clearing history', async () => {
      // Record change but don't sync
      await pipe(tracker.recordChange({
        table: 'unsynced',
        operation: 'INSERT',
        data: { id: 'unsynced' },
      }))();

      // Clear all history
      await pipe(tracker.clearHistory(Date.now() + 1000))();

      // Unsynced change should still exist
      const result = await pipe(tracker.getUnsyncedChanges())();
      
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(1);
      }
    });

    it('should handle UPDATE with oldData', async () => {
      const result = await pipe(tracker.recordChange({
        table: 'users',
        operation: 'UPDATE',
        data: { id: '1', name: 'New Name' },
        oldData: { id: '1', name: 'Old Name' },
      }))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right.oldData).toEqual({ id: '1', name: 'Old Name' });
      }
    });

    it('should handle DELETE operation', async () => {
      const result = await pipe(tracker.recordChange({
        table: 'users',
        operation: 'DELETE',
        data: { id: '1' },
      }))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right.operation).toBe('DELETE');
      }
    });
  });
});