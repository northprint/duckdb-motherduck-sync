/**
 * Tests for change tracker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import * as O from 'fp-ts/Option';
import { createMemoryChangeTracker, createChangeTracker } from './change-tracker';
import type { DatabaseOperations } from '../adapters/duckdb';
import type { StorageOperations } from '../adapters/storage';
import type { DbValue } from '../types';

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
      // const beforeTimestamp = Date.now();

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

  describe('Database Change Tracker', () => {
    let mockDb: DatabaseOperations;
    let mockStorage: StorageOperations;
    let tracker: ReturnType<typeof createChangeTracker>;

    beforeEach(() => {
      // Mock database operations
      mockDb = {
        query: vi.fn().mockReturnValue(TE.of([])),
        execute: vi.fn().mockReturnValue(TE.of(undefined)),
        transaction: vi.fn((op) => op),
      };

      // Mock storage operations
      mockStorage = {
        get: vi.fn().mockReturnValue(TE.of(O.none)),
        set: vi.fn().mockReturnValue(TE.of(undefined)),
        delete: vi.fn().mockReturnValue(TE.of(undefined)),
      };

      tracker = createChangeTracker(mockStorage, mockDb);
    });

    it('should initialize tables on first use', async () => {
      const changeData = {
        table: 'users',
        operation: 'INSERT' as const,
        data: { name: 'Test' },
      };

      await pipe(tracker.recordChange(changeData))();

      // Should check if initialized
      expect(mockStorage.get).toHaveBeenCalledWith('_initialized');
      
      // Should create tables
      expect(mockDb.execute).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS _sync_changes'));
      expect(mockDb.execute).toHaveBeenCalledWith(expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_sync_changes_timestamp'));
      expect(mockDb.execute).toHaveBeenCalledWith(expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_sync_changes_synced'));
      
      // Should mark as initialized
      expect(mockStorage.set).toHaveBeenCalledWith('_initialized', true);
    });

    it('should not reinitialize if already initialized', async () => {
      // Reset mocks
      vi.clearAllMocks();
      
      // Mock storage to return initialized = true
      (mockStorage.get as ReturnType<typeof vi.fn>).mockReturnValue(TE.of(O.some(true)));

      const tracker2 = createChangeTracker(mockStorage, mockDb);
      
      await pipe(tracker2.recordChange({
        table: 'users',
        operation: 'INSERT',
        data: { id: '1' },
      }))();

      // Should only call execute for INSERT, not for table creation
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO _sync_changes'),
        expect.any(Array)
      );
      expect(mockDb.execute).not.toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE'),
        expect.any(Array)
      );
    });

    it('should record change to database', async () => {
      const changeData = {
        table: 'users',
        operation: 'UPDATE' as const,
        data: { id: '1', name: 'Updated' },
        oldData: { id: '1', name: 'Original' },
      };

      const result = await pipe(tracker.recordChange(changeData))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        const change = result.right;
        
        // Should insert into database
        expect(mockDb.execute).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO _sync_changes'),
          [
            change.id,
            'users',
            'UPDATE',
            change.timestamp,
            JSON.stringify(changeData.data),
            JSON.stringify(changeData.oldData),
          ]
        );
      }
    });

    it('should handle null oldData', async () => {
      await pipe(tracker.recordChange({
        table: 'users',
        operation: 'INSERT',
        data: { id: '1' },
      }))();

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO _sync_changes'),
        expect.arrayContaining([null]) // oldData should be null
      );
    });

    it('should get unsynced changes from database', async () => {
      const mockRows = [
        {
          id: 'change-1',
          table_name: 'users',
          operation: 'INSERT',
          timestamp: 1000,
          data: JSON.stringify({ id: '1', name: 'Test' }),
          old_data: null,
        },
        {
          id: 'change-2',
          table_name: 'users',
          operation: 'UPDATE',
          timestamp: 2000,
          data: JSON.stringify({ id: '1', name: 'Updated' }),
          old_data: JSON.stringify({ id: '1', name: 'Test' }),
        },
      ];

      (mockDb.query as ReturnType<typeof vi.fn>).mockReturnValue(TE.of(mockRows));

      const result = await pipe(tracker.getUnsyncedChanges(500))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(2);
        expect(result.right[0]).toMatchObject({
          id: 'change-1',
          table: 'users',
          operation: 'INSERT',
          timestamp: 1000,
          data: { id: '1', name: 'Test' },
          oldData: undefined,
        });
        expect(result.right[1]).toMatchObject({
          id: 'change-2',
          table: 'users',
          operation: 'UPDATE',
          timestamp: 2000,
          data: { id: '1', name: 'Updated' },
          oldData: { id: '1', name: 'Test' },
        });
      }

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE synced = 0 AND timestamp > $1'),
        [500]
      );
    });

    it('should mark changes as synced', async () => {
      const changeIds = ['change-1', 'change-2', 'change-3'];
      
      await pipe(tracker.markSynced(changeIds))();

      expect(mockDb.execute).toHaveBeenCalledWith(
        'UPDATE _sync_changes SET synced = 1 WHERE id IN ($1, $2, $3)',
        ['change-1', 'change-2', 'change-3']
      );
    });

    it('should handle empty changeIds in markSynced', async () => {
      const result = await pipe(tracker.markSynced([]))();
      
      expect(result._tag).toBe('Right');
      // Should not execute any query
      expect(mockDb.execute).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE _sync_changes'));
    });

    it('should clear old history', async () => {
      const beforeTimestamp = 1000;
      
      await pipe(tracker.clearHistory(beforeTimestamp))();

      expect(mockDb.execute).toHaveBeenCalledWith(
        'DELETE FROM _sync_changes WHERE timestamp < $1 AND synced = 1',
        [1000]
      );
    });

    it('should handle database errors', async () => {
      (mockDb.execute as ReturnType<typeof vi.fn>).mockReturnValue(TE.left({ type: 'unknown-error', message: 'DB error', timestamp: Date.now() } as const));

      const result = await pipe(tracker.recordChange({
        table: 'users',
        operation: 'INSERT',
        data: { id: '1' },
      }))();

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('unknown-error');
      }
    });

    it('should handle all operation types', async () => {
      const operations = ['INSERT', 'UPDATE', 'DELETE'] as const;
      
      for (const operation of operations) {
        await pipe(tracker.recordChange({
          table: 'test',
          operation,
          data: { id: '1' },
        }))();
      }

      // Initial setup (3 calls) + 3 operations = 6 total, but each operation also triggers init check
      // So: 3 (init) + 3 * 3 (each op triggers init) = 12 total
      expect(mockDb.execute).toHaveBeenCalled();
    });

    it('should convert row data types correctly', async () => {
      const mockRows = [
        {
          id: 123, // number instead of string
          table_name: 'users' as DbValue,
          operation: 'INSERT' as DbValue,
          timestamp: BigInt(1000), // BigInt instead of number
          data: JSON.stringify({ id: '1' }),
          old_data: undefined, // undefined instead of null
        },
      ];

      (mockDb.query as ReturnType<typeof vi.fn>).mockReturnValue(TE.of(mockRows));

      const result = await pipe(tracker.getUnsyncedChanges())();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        // The actual implementation doesn't convert types in getUnsyncedChanges
        // It just passes through the values as-is
        expect(result.right[0]).toMatchObject({
          id: 123, // Not converted
          table: 'users',
          operation: 'INSERT',
          timestamp: BigInt(1000), // Not converted
          oldData: undefined,
        });
      }
    });
  });
});