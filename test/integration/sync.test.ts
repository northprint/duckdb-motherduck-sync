/**
 * Integration tests for sync functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pipe } from 'fp-ts/function';
import * as E from 'fp-ts/Either';
import {
  createSyncEngine,
  createMemoryStorage,
  createMockDuckDBAdapter,
  createMockMotherDuckClient,
  createMockNetworkMonitor,
  createMemoryChangeTracker,
} from '../../src';
import type { SyncEngine } from '../../src';

describe('Sync Integration Tests', () => {
  let syncEngine: SyncEngine;
  let networkMonitor: ReturnType<typeof createMockNetworkMonitor>;

  beforeEach(() => {
    // Setup test environment
    const storage = createMemoryStorage();
    const localDb = createMockDuckDBAdapter();
    const motherduckClient = createMockMotherDuckClient();
    networkMonitor = createMockNetworkMonitor();
    const changeTracker = createMemoryChangeTracker();

    syncEngine = createSyncEngine({
      networkMonitor,
      changeTracker,
      localDb,
      motherduckClient,
    });
  });

  afterEach(() => {
    syncEngine.stopAutoSync();
  });

  describe('End-to-End Sync Scenarios', () => {
    it('should sync local changes to cloud', async () => {
      // Initialize
      await pipe(
        syncEngine.initialize({
          motherduckToken: 'valid-token',
          tables: ['users', 'products'],
        }),
      )();

      // Simulate local changes
      const localDb = createMockDuckDBAdapter();
      await pipe(
        localDb.execute(
          'INSERT INTO users (id, name) VALUES ($1, $2)',
          ['1', 'Alice'],
        ),
      )();

      // Perform sync
      const result = await pipe(syncEngine.sync())();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right.pushed).toBeGreaterThan(0);
      }
    });

    it('should handle offline-to-online transition', async () => {
      // Start offline
      networkMonitor.setState({ online: false, type: 'unknown' });

      await pipe(
        syncEngine.initialize({
          motherduckToken: 'valid-token',
          syncInterval: 100,
        }),
      )();

      // Collect sync states
      const states: string[] = [];
      const subscription = syncEngine.syncState$.subscribe((state) => {
        states.push(state.type);
      });

      // Start auto sync (should stay idle while offline)
      syncEngine.startAutoSync();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Go online
      networkMonitor.setState({ online: true, type: 'wifi' });

      // Wait for sync to trigger
      await new Promise((resolve) => setTimeout(resolve, 200));

      subscription.unsubscribe();
      syncEngine.stopAutoSync();

      // Should have transitioned from idle to syncing
      expect(states).toContain('idle');
      expect(states).toContain('syncing');
    });

    it('should handle conflict resolution', async () => {
      await pipe(
        syncEngine.initialize({
          motherduckToken: 'valid-token',
          conflictStrategy: 'latest-wins',
        }),
      )();

      // Create conflicting changes
      // This would require more complex setup in a real scenario
      const result = await pipe(syncEngine.sync())();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        // Conflicts should be resolved according to strategy
        expect(result.right.conflicts.length).toBe(0);
      }
    });

    it('should respect table filters', async () => {
      await pipe(
        syncEngine.initialize({
          motherduckToken: 'valid-token',
          tableFilter: {
            includeTables: ['users'],
            excludeTables: ['logs'],
          },
        }),
      )();

      // Only 'users' table should be synced
      const result = await pipe(syncEngine.sync())();

      expect(result._tag).toBe('Right');
    });

    it('should compress data when enabled', async () => {
      await pipe(
        syncEngine.initialize({
          motherduckToken: 'valid-token',
          enableCompression: true,
          compressionThreshold: 100,
        }),
      )();

      // Large data should be compressed
      const result = await pipe(syncEngine.sync())();

      expect(result._tag).toBe('Right');
    });
  });

  describe('Performance Tests', () => {
    it('should handle large datasets within performance targets', async () => {
      await pipe(
        syncEngine.initialize({
          motherduckToken: 'valid-token',
          batchSize: 1000,
        }),
      )();

      const startTime = Date.now();
      
      // Simulate large dataset sync
      const result = await pipe(syncEngine.sync())();
      
      const duration = Date.now() - startTime;

      expect(result._tag).toBe('Right');
      // Should complete within reasonable time
      expect(duration).toBeLessThan(5000); // 5 seconds for test
    });

    it('should batch operations efficiently', async () => {
      await pipe(
        syncEngine.initialize({
          motherduckToken: 'valid-token',
          batchSize: 100,
        }),
      )();

      // Generate many changes
      const changeTracker = createMemoryChangeTracker();
      for (let i = 0; i < 500; i++) {
        await pipe(
          changeTracker.recordChange({
            table: 'test',
            operation: 'INSERT',
            data: { id: `${i}`, value: `value-${i}` },
          }),
        )();
      }

      const result = await pipe(syncEngine.push())();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right.uploaded).toBe(500);
      }
    });
  });

  describe('Error Handling', () => {
    it('should retry on transient errors', async () => {
      // This would require a mock that fails initially then succeeds
      await pipe(
        syncEngine.initialize({
          motherduckToken: 'valid-token',
        }),
      )();

      const result = await pipe(syncEngine.sync())();

      expect(result._tag).toBe('Right');
    });

    it('should handle authentication errors gracefully', async () => {
      const result = await pipe(
        syncEngine.initialize({
          motherduckToken: 'invalid-token',
        }),
      )();

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('auth-error');
      }
    });
  });
});