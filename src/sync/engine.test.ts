/**
 * Tests for sync engine
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import { firstValueFrom } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import { createSyncEngine } from './engine';
import { createMockNetworkMonitor } from '../core/network-monitor';
import { createMemoryChangeTracker } from '../core/change-tracker';
import { createMockDuckDBAdapter } from '../adapters/duckdb';
import { createMockMotherDuckClient } from '../adapters/motherduck';
import type { SyncEngine, SyncEngineDeps } from './engine';
import type { SyncConfig } from '../types';

describe('Sync Engine', () => {
  let engine: SyncEngine;
  let deps: SyncEngineDeps;
  let networkMonitor: ReturnType<typeof createMockNetworkMonitor>;
  let changeTracker: ReturnType<typeof createMemoryChangeTracker>;

  beforeEach(() => {
    networkMonitor = createMockNetworkMonitor();
    changeTracker = createMemoryChangeTracker();

    deps = {
      networkMonitor,
      changeTracker,
      localDb: createMockDuckDBAdapter(),
      motherduckClient: createMockMotherDuckClient(),
    };

    engine = createSyncEngine(deps);
  });

  describe('initialization', () => {
    it('should initialize with valid config', async () => {
      const config: SyncConfig = {
        motherduckToken: 'valid-token',
        tables: ['users', 'products'],
      };

      const result = await pipe(engine.initialize(config))();

      expect(result._tag).toBe('Right');
    });

    it('should fail with invalid token', async () => {
      const config: SyncConfig = {
        motherduckToken: 'invalid-token',
        tables: ['users'],
      };

      const result = await pipe(engine.initialize(config))();

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('auth-error');
      }
    });
  });

  describe('push operation', () => {
    beforeEach(async () => {
      const config: SyncConfig = {
        motherduckToken: 'valid-token',
        tables: ['users'],
      };
      await pipe(engine.initialize(config))();
    });

    it('should push local changes', async () => {
      // Record some changes
      await pipe(changeTracker.recordChange({
        table: 'users',
        operation: 'INSERT',
        data: { id: '1', name: 'Alice' },
      }))();

      await pipe(changeTracker.recordChange({
        table: 'users',
        operation: 'UPDATE',
        data: { id: '2', name: 'Bob' },
      }))();

      const result = await pipe(engine.push())();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right.uploaded).toBe(2);
        expect(result.right.failed).toBe(0);
      }

      // Verify changes are marked as synced
      const unsynced = await pipe(changeTracker.getUnsyncedChanges())();
      if (unsynced._tag === 'Right') {
        expect(unsynced.right).toHaveLength(0);
      }
    });

    it('should handle empty changes', async () => {
      const result = await pipe(engine.push())();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right.uploaded).toBe(0);
      }
    });
  });

  describe('pull operation', () => {
    beforeEach(async () => {
      const config: SyncConfig = {
        motherduckToken: 'valid-token',
        tables: ['users'],
      };
      await pipe(engine.initialize(config))();
    });

    it('should handle pull with no tables configured', async () => {
      // Initialize without tables
      await pipe(engine.initialize({
        motherduckToken: 'valid-token',
      }))();

      const result = await pipe(engine.pull())();

      expect(result._tag).toBe('Left');
    });
  });

  describe('sync operation', () => {
    beforeEach(async () => {
      const config: SyncConfig = {
        motherduckToken: 'valid-token',
        tables: ['users'],
      };
      await pipe(engine.initialize(config))();
    });

    it('should perform full sync', async () => {
      // Record a change
      await pipe(changeTracker.recordChange({
        table: 'users',
        operation: 'INSERT',
        data: { id: '1', name: 'Test' },
      }))();

      const result = await pipe(engine.sync())();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right.pushed).toBeGreaterThanOrEqual(0);
        expect(result.right.pulled).toBeGreaterThanOrEqual(0);
        expect(result.right.duration).toBeGreaterThan(0);
      }
    });
  });

  describe('auto sync', () => {
    it('should start and stop auto sync', async () => {
      const config: SyncConfig = {
        motherduckToken: 'valid-token',
        tables: ['users'],
        syncInterval: 100, // 100ms for testing
      };

      await pipe(engine.initialize(config))();

      // Collect state changes
      const statesPromise = firstValueFrom(
        engine.startAutoSync().pipe(
          take(3),
          toArray(),
        ),
      );

      // Wait a bit and stop
      setTimeout(() => engine.stopAutoSync(), 250);

      const states = await statesPromise;

      // Should have multiple state transitions
      expect(states.length).toBeGreaterThan(0);
      expect(states.some(s => s.type === 'syncing')).toBe(true);
    });

    it('should respect network state', async () => {
      const config: SyncConfig = {
        motherduckToken: 'valid-token',
        tables: ['users'],
        syncInterval: 100,
      };

      await pipe(engine.initialize(config))();

      // Go offline first
      networkMonitor.setState({ online: false, type: 'unknown' });
      
      // Give time for the state to update
      await new Promise(resolve => setTimeout(resolve, 10));

      const statesPromise = firstValueFrom(
        engine.startAutoSync().pipe(
          take(2),
          toArray(),
        ),
      );

      // Wait and go back online
      setTimeout(() => {
        networkMonitor.setState({ online: true, type: 'wifi' });
      }, 150);

      const states = await statesPromise;
      engine.stopAutoSync();

      // Should stay idle when offline
      expect(states[0]?.type).toBe('idle');
    });
  });

  describe('state management', () => {
    it('should emit state changes', async () => {
      const config: SyncConfig = {
        motherduckToken: 'valid-token',
        tables: ['users'],
      };

      // Start collecting states
      const states: SyncState[] = [];
      const subscription = engine.syncState$.subscribe(state => {
        states.push(state);
      });

      await pipe(engine.initialize(config))();
      await pipe(engine.sync())();

      // Give time for states to emit
      await new Promise(resolve => setTimeout(resolve, 50));
      
      subscription.unsubscribe();

      expect(states.length).toBeGreaterThanOrEqual(2);
      expect(states[0]?.type).toBe('idle'); // After init
      expect(states[1]?.type).toBe('syncing'); // During sync
    });
  });
});