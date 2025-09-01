/**
 * Tests for base types
 */

import { describe, it, expect } from 'vitest';
import type { 
  DbRecord, 
  Change, 
  SyncState, 
  NetworkState,
  ConflictStrategy,
  Conflict,
  SyncEvent,
  SyncDirection,
  SyncConfig,
  SyncResult,
  PushResult,
  PullResult,
  MergeFunction,
  Timestamp,
  DbValue,
  OperationType
} from './base';

describe('Base Types', () => {
  describe('DbValue', () => {
    it('should accept valid database values', () => {
      const stringValue: DbValue = 'text';
      const numberValue: DbValue = 123;
      const booleanValue: DbValue = true;
      const nullValue: DbValue = null;
      const dateValue: DbValue = new Date();
      const binaryValue: DbValue = new Uint8Array([1, 2, 3]);

      expect(stringValue).toBe('text');
      expect(numberValue).toBe(123);
      expect(booleanValue).toBe(true);
      expect(nullValue).toBeNull();
      expect(dateValue).toBeInstanceOf(Date);
      expect(binaryValue).toBeInstanceOf(Uint8Array);
    });
  });

  describe('DbRecord', () => {
    it('should create valid database records', () => {
      const record: DbRecord = {
        id: '123',
        name: 'John',
        age: 30,
        active: true,
        created: new Date(),
        data: new Uint8Array([1, 2, 3])
      };

      expect(record.id).toBe('123');
      expect(record.name).toBe('John');
      expect(record.age).toBe(30);
      expect(record.active).toBe(true);
      expect(record.created).toBeInstanceOf(Date);
      expect(record.data).toBeInstanceOf(Uint8Array);
    });
  });

  describe('OperationType', () => {
    it('should handle all operation types', () => {
      const insert: OperationType = 'INSERT';
      const update: OperationType = 'UPDATE';
      const del: OperationType = 'DELETE';

      expect(insert).toBe('INSERT');
      expect(update).toBe('UPDATE');
      expect(del).toBe('DELETE');
    });
  });

  describe('Change', () => {
    it('should create valid change objects', () => {
      const insertChange: Change = {
        id: '456',
        table: 'users',
        operation: 'INSERT',
        timestamp: Date.now(),
        data: { name: 'Jane', email: 'jane@example.com' }
      };

      const updateChange: Change = {
        id: '789',
        table: 'users',
        operation: 'UPDATE',
        timestamp: Date.now(),
        data: { name: 'Jane Doe' },
        oldData: { name: 'Jane' }
      };

      expect(insertChange.operation).toBe('INSERT');
      expect(updateChange.operation).toBe('UPDATE');
      expect(updateChange.oldData).toBeDefined();
    });
  });

  describe('Conflict', () => {
    it('should create valid conflict objects', () => {
      const conflict: Conflict = {
        table: 'users',
        key: { id: 'user-1' },
        localValue: { name: 'Local User' },
        remoteValue: { name: 'Remote User' },
        localTimestamp: Date.now() - 1000,
        remoteTimestamp: Date.now()
      };

      expect(conflict.table).toBe('users');
      expect(conflict.key.id).toBe('user-1');
      expect(conflict.localValue.name).toBe('Local User');
      expect(conflict.remoteValue.name).toBe('Remote User');
      expect(conflict.localTimestamp).toBeLessThan(conflict.remoteTimestamp);
    });
  });

  describe('ConflictStrategy', () => {
    it('should handle all conflict strategies', () => {
      const localWins: ConflictStrategy = { type: 'local-wins' };
      const remoteWins: ConflictStrategy = { type: 'remote-wins' };
      const latestWins: ConflictStrategy = { type: 'latest-wins' };
      const manual: ConflictStrategy = { type: 'manual' };
      
      const mergeFunc: MergeFunction = (local, remote) => ({
        ...local,
        ...remote
      });
      const merge: ConflictStrategy = { 
        type: 'merge',
        mergeFunction: mergeFunc
      };

      expect(localWins.type).toBe('local-wins');
      expect(remoteWins.type).toBe('remote-wins');
      expect(latestWins.type).toBe('latest-wins');
      expect(manual.type).toBe('manual');
      expect(merge.type).toBe('merge');
      expect(merge.mergeFunction).toBeDefined();
    });
  });

  describe('SyncConfig', () => {
    it('should create valid sync configuration', () => {
      const config: SyncConfig = {
        motherduckToken: 'test-token',
        syncInterval: 30000,
        conflictStrategy: { type: 'latest-wins' },
        tables: ['users', 'products'],
        batchSize: 100,
        motherduckApiUrl: 'https://api.motherduck.com',
        enableCompression: true,
        compressionThreshold: 1024,
        tableFilter: {
          includeTables: ['users'],
          excludeTables: ['logs'],
          includePatterns: ['user_.*'],
          excludePatterns: ['.*_temp']
        },
        useWebWorker: true,
        workerPoolSize: 4
      };

      expect(config.motherduckToken).toBe('test-token');
      expect(config.syncInterval).toBe(30000);
      expect(config.conflictStrategy?.type).toBe('latest-wins');
      expect(config.tables).toHaveLength(2);
      expect(config.tableFilter?.includeTables).toContain('users');
    });
  });

  describe('SyncState', () => {
    it('should handle all sync states', () => {
      const idle: SyncState = { type: 'idle' };
      const syncing: SyncState = { type: 'syncing', progress: 50 };
      const error: SyncState = { type: 'error', error: new Error('Sync failed') };
      const conflictState: SyncState = { 
        type: 'conflict', 
        conflicts: [
          {
            table: 'users',
            key: { id: '1' },
            localValue: { name: 'A' },
            remoteValue: { name: 'B' },
            localTimestamp: 1000,
            remoteTimestamp: 2000
          }
        ]
      };

      expect(idle.type).toBe('idle');
      expect(syncing.type).toBe('syncing');
      expect(syncing.progress).toBe(50);
      expect(error.type).toBe('error');
      expect(error.error).toBeInstanceOf(Error);
      expect(conflictState.type).toBe('conflict');
      expect(conflictState.conflicts).toHaveLength(1);
    });
  });

  describe('NetworkState', () => {
    it('should create valid network state', () => {
      const online: NetworkState = {
        online: true,
        type: 'wifi',
        effectiveType: '4g'
      };

      const offline: NetworkState = {
        online: false,
        type: 'unknown'
      };

      expect(online.online).toBe(true);
      expect(online.type).toBe('wifi');
      expect(online.effectiveType).toBe('4g');
      expect(offline.online).toBe(false);
    });
  });

  describe('SyncResult', () => {
    it('should create valid sync results', () => {
      const result: SyncResult = {
        pushed: 10,
        pulled: 20,
        conflicts: [],
        errors: [new Error('Minor error')],
        duration: 1500
      };

      expect(result.pushed).toBe(10);
      expect(result.pulled).toBe(20);
      expect(result.conflicts).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.duration).toBe(1500);
    });
  });

  describe('PushResult', () => {
    it('should create valid push results', () => {
      const result: PushResult = {
        uploaded: 5,
        errors: [],
        duration: 500
      };

      expect(result.uploaded).toBe(5);
      expect(result.errors).toHaveLength(0);
      expect(result.duration).toBe(500);
    });
  });

  describe('PullResult', () => {
    it('should create valid pull results', () => {
      const result: PullResult = {
        downloaded: 15,
        errors: [],
        duration: 750
      };

      expect(result.downloaded).toBe(15);
      expect(result.errors).toHaveLength(0);
      expect(result.duration).toBe(750);
    });
  });

  describe('SyncEvent', () => {
    it('should handle all sync events', () => {
      const startEvent: SyncEvent = {
        type: 'sync-started',
        timestamp: Date.now()
      };

      const progressEvent: SyncEvent = {
        type: 'sync-progress',
        timestamp: Date.now(),
        progress: 75,
        message: '75% complete'
      };

      const errorEvent: SyncEvent = {
        type: 'sync-error',
        timestamp: Date.now(),
        error: new Error('Sync error')
      };

      const completeEvent: SyncEvent = {
        type: 'sync-completed',
        timestamp: Date.now(),
        result: {
          pushed: 5,
          pulled: 10,
          conflicts: [],
          errors: [],
          duration: 1000
        }
      };

      expect(startEvent.type).toBe('sync-started');
      expect(progressEvent.type).toBe('sync-progress');
      expect(progressEvent.progress).toBe(75);
      expect(errorEvent.type).toBe('sync-error');
      expect(errorEvent.error).toBeInstanceOf(Error);
      expect(completeEvent.type).toBe('sync-completed');
      expect(completeEvent.result?.pushed).toBe(5);
    });
  });

  describe('SyncDirection', () => {
    it('should handle sync directions', () => {
      const push: SyncDirection = 'push';
      const pull: SyncDirection = 'pull';
      const bidirectional: SyncDirection = 'bidirectional';

      expect(push).toBe('push');
      expect(pull).toBe('pull');
      expect(bidirectional).toBe('bidirectional');
    });
  });

  describe('Timestamp', () => {
    it('should handle timestamp values', () => {
      const now: Timestamp = Date.now();
      const past: Timestamp = new Date('2024-01-01').getTime();
      
      expect(typeof now).toBe('number');
      expect(typeof past).toBe('number');
      expect(now).toBeGreaterThan(past);
    });
  });

  describe('MergeFunction', () => {
    it('should merge records correctly', () => {
      const merge: MergeFunction = (local, remote, _base) => {
        // Simple merge: remote wins for conflicts
        return { ...local, ...remote };
      };

      const local = { id: '1', name: 'Local', value: 10 };
      const remote = { id: '1', name: 'Remote', status: 'active' };
      const result = merge(local, remote);

      expect(result.id).toBe('1');
      expect(result.name).toBe('Remote'); // Remote wins
      expect(result.value).toBe(10); // From local
      expect(result.status).toBe('active'); // From remote
    });
  });
});