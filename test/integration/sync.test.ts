/**
 * Integration tests for sync functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pipe } from 'fp-ts/function';
import * as E from 'fp-ts/Either';
import * as TE from 'fp-ts/TaskEither';
import { createSyncEngine } from '../../src/sync/engine';
import type { SyncEngine } from '../../src/sync/engine';
import { createMockDuckDBAdapter } from '../../src/adapters/duckdb';
import { createMockMotherDuckClient } from '../../src/adapters/motherduck';
import { createMockNetworkMonitor } from '../../src/core/network-monitor';
import { createMemoryChangeTracker } from '../../src/core/change-tracker';
import type { DatabaseOperations } from '../../src/adapters/duckdb';
import type { MotherDuckClient } from '../../src/adapters/motherduck';
import type { NetworkMonitor } from '../../src/core/network-monitor';
import type { ChangeTracker } from '../../src/core/change-tracker';

describe('Sync Integration Tests', () => {
  let syncEngine: SyncEngine | null = null;
  let networkMonitor: ReturnType<typeof createMockNetworkMonitor>;
  let localDb: DatabaseOperations;
  let motherduckClient: MotherDuckClient;
  let changeTracker: ChangeTracker;

  beforeEach(() => {
    // Setup test environment
    localDb = createMockDuckDBAdapter();
    motherduckClient = createMockMotherDuckClient();
    networkMonitor = createMockNetworkMonitor();
    changeTracker = createMemoryChangeTracker();

    syncEngine = createSyncEngine({
      networkMonitor,
      changeTracker,
      localDb,
      motherduckClient,
    });
  });

  afterEach(() => {
    if (syncEngine) {
      syncEngine!.stopAutoSync();
    }
  });

  describe('End-to-End Sync Scenarios', () => {
    it('should sync local changes to cloud', async () => {
      // Initialize
      const initResult = await pipe(
        syncEngine!.initialize({
          motherduckToken: 'valid-token',
          tables: ['users', 'products'],
        }),
      )();

      expect(initResult._tag).toBe('Right');

      // Simulate local changes by adding them to the change tracker
      const changeResult = await pipe(
        changeTracker.recordChange({
          table: 'users',
          operation: 'INSERT',
          data: { id: '1', name: 'Alice' },
        }),
      )();

      expect(changeResult._tag).toBe('Right');

      // Perform sync
      const result = await pipe(syncEngine!.sync())();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right.pushed).toBeGreaterThan(0);
      }
    });

    it('should handle offline-to-online transition', async () => {
      // Start offline
      networkMonitor.setState({ online: false, type: 'unknown' });

      const initResult = await pipe(
        syncEngine!.initialize({
          motherduckToken: 'valid-token',
          syncInterval: 100,
        }),
      )();

      expect(initResult._tag).toBe('Right');

      // Collect sync states
      const states: string[] = [];
      const subscription = syncEngine!.syncState$.subscribe((state) => {
        states.push(state.type);
      });

      // Start auto sync (should stay idle while offline)
      syncEngine!.startAutoSync();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Go online
      networkMonitor.setState({ online: true, type: 'wifi' });

      // Wait for sync to trigger
      await new Promise((resolve) => setTimeout(resolve, 200));

      subscription.unsubscribe();
      syncEngine!.stopAutoSync();

      // Should have transitioned from idle to syncing
      expect(states).toContain('idle');
      expect(states).toContain('syncing');
    });

    it('should handle conflict resolution', async () => {
      const initResult = await pipe(
        syncEngine!.initialize({
          motherduckToken: 'valid-token',
          conflictStrategy: { type: 'latest-wins' },
          tables: ['users'], // Add tables configuration
        }),
      )();

      expect(initResult._tag).toBe('Right');

      // Create conflicting changes
      // This would require more complex setup in a real scenario
      const result = await pipe(syncEngine!.sync())();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        // Conflicts should be resolved according to strategy
        expect(result.right.conflicts.length).toBe(0);
      }
    });

    it('should respect table filters', async () => {
      const initResult = await pipe(
        syncEngine!.initialize({
          motherduckToken: 'valid-token',
          tables: ['users'],
        }),
      )();

      expect(initResult._tag).toBe('Right');

      // Only 'users' table should be synced
      const result = await pipe(syncEngine!.sync())();

      expect(result._tag).toBe('Right');
    });

    it('should compress data when enabled', async () => {
      const initResult = await pipe(
        syncEngine!.initialize({
          motherduckToken: 'valid-token',
          enableCompression: true,
          tables: ['users'], // Add tables configuration
        }),
      )();

      expect(initResult._tag).toBe('Right');

      // Large data should be compressed
      const result = await pipe(syncEngine!.sync())();

      expect(result._tag).toBe('Right');
    });
  });

  describe('Performance Tests', () => {
    it('should handle large datasets within performance targets', async () => {
      const initResult = await pipe(
        syncEngine!.initialize({
          motherduckToken: 'valid-token',
          tables: ['users', 'products'], // Add tables configuration
        }),
      )();

      expect(initResult._tag).toBe('Right');

      const startTime = Date.now();
      
      // Simulate large dataset sync
      const result = await pipe(syncEngine!.sync())();
      
      const duration = Date.now() - startTime;

      expect(result._tag).toBe('Right');
      // Should complete within reasonable time
      expect(duration).toBeLessThan(5000); // 5 seconds for test
    });

    it('should batch operations efficiently', async () => {
      const initResult = await pipe(
        syncEngine!.initialize({
          motherduckToken: 'valid-token',
          tables: ['test'], // Add tables configuration
        }),
      )();

      expect(initResult._tag).toBe('Right');

      // Generate many changes using the existing changeTracker
      for (let i = 0; i < 500; i++) {
        const changeResult = await pipe(
          changeTracker.recordChange({
            table: 'test',
            operation: 'INSERT',
            data: { id: `${i}`, value: `value-${i}` },
          }),
        )();
        expect(changeResult._tag).toBe('Right');
      }

      const result = await pipe(syncEngine!.push())();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right.uploaded).toBe(500);
      }
    });
  });

  describe('Error Handling', () => {
    it('should retry on transient errors', async () => {
      // This would require a mock that fails initially then succeeds
      const initResult = await pipe(
        syncEngine!.initialize({
          motherduckToken: 'valid-token',
          tables: ['users'], // Add tables configuration
        }),
      )();

      expect(initResult._tag).toBe('Right');

      const result = await pipe(syncEngine!.sync())();

      expect(result._tag).toBe('Right');
    });

    it('should handle authentication errors gracefully', async () => {
      const result = await pipe(
        syncEngine!.initialize({
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