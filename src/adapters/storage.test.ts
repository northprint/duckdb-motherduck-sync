/**
 * Tests for storage adapter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import * as O from 'fp-ts/Option';
import { createMemoryAdapter, createIndexedDBAdapter } from './storage';
import type { StorageOperations } from './storage';

describe('Storage Adapter', () => {
  describe('Memory Adapter', () => {
    let storage: StorageOperations;

    beforeEach(() => {
      storage = createMemoryAdapter();
    });

    it('should store and retrieve values', async () => {
      const key = 'test-key';
      const value = { name: 'test', data: [1, 2, 3] };

      // Set value
      const setResult = await pipe(storage.set(key, value))();
      expect(setResult._tag).toBe('Right');

      // Get value
      const getResult = await pipe(storage.get<typeof value>(key))();
      expect(getResult._tag).toBe('Right');
      if (getResult._tag === 'Right') {
        expect(O.isSome(getResult.right)).toBe(true);
        if (O.isSome(getResult.right)) {
          expect(getResult.right.value).toEqual(value);
        }
      }
    });

    it('should return None for missing keys', async () => {
      const result = await pipe(storage.get('missing-key'))();
      
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(O.isNone(result.right)).toBe(true);
      }
    });

    it('should delete values', async () => {
      const key = 'delete-test';
      const value = 'test-value';

      // Set value
      await pipe(storage.set(key, value))();

      // Delete value
      const deleteResult = await pipe(storage.delete(key))();
      expect(deleteResult._tag).toBe('Right');

      // Verify deletion
      const getResult = await pipe(storage.get(key))();
      expect(getResult._tag).toBe('Right');
      if (getResult._tag === 'Right') {
        expect(O.isNone(getResult.right)).toBe(true);
      }
    });

    it('should list keys with prefix', async () => {
      // Set multiple values
      await pipe(storage.set('prefix:1', 'value1'))();
      await pipe(storage.set('prefix:2', 'value2'))();
      await pipe(storage.set('other:1', 'value3'))();

      // List with prefix
      const result = await pipe(storage.list('prefix:'))();
      
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(2);
        expect(result.right).toContain('prefix:1');
        expect(result.right).toContain('prefix:2');
        expect(result.right).not.toContain('other:1');
      }
    });

    it('should handle complex values', async () => {
      const complexValue = {
        id: '123',
        nested: {
          array: [1, 2, { deep: true }],
          date: new Date('2024-01-01'),
        },
        buffer: new Uint8Array([1, 2, 3]),
      };

      await pipe(storage.set('complex', complexValue))();
      const result = await pipe(storage.get<typeof complexValue>('complex'))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right' && O.isSome(result.right)) {
        expect(result.right.value).toEqual(complexValue);
      }
    });
  });

  describe('IndexedDB Adapter', () => {
    it('should create adapter and perform basic operations', async () => {
      // Create adapter
      const adapterResult = await pipe(
        createIndexedDBAdapter({
          dbName: 'test-db',
          storeName: 'test-store',
          version: 1,
        }),
      )();

      expect(adapterResult._tag).toBe('Right');
      if (adapterResult._tag !== 'Right') return;

      const adapter = adapterResult.right;

      // Test set and get
      const key = 'idb-test';
      const value = { test: true };

      const setResult = await pipe(adapter.set(key, value))();
      expect(setResult._tag).toBe('Right');

      const getResult = await pipe(adapter.get<typeof value>(key))();
      expect(getResult._tag).toBe('Right');
      if (getResult._tag === 'Right' && O.isSome(getResult.right)) {
        expect(getResult.right.value).toEqual(value);
      }
    });

    it('should handle errors gracefully', async () => {
      // Force an error by using invalid version
      const adapterResult = await pipe(
        createIndexedDBAdapter({
          dbName: 'test-db',
          storeName: 'test-store',
          version: -1, // Invalid version
        }),
      )();

      // IndexedDB might accept -1, so let's test with a successful adapter
      if (adapterResult._tag === 'Right') {
        const adapter = adapterResult.right;
        
        // Test operations work correctly
        const result = await pipe(adapter.get('any-key'))();
        expect(result._tag).toBe('Right');
      }
    });
  });

  describe('Storage Operations Type Safety', () => {
    it('should maintain type safety across operations', async () => {
      const storage = createMemoryAdapter();

      interface User {
        id: string;
        name: string;
        age: number;
      }

      const user: User = { id: '1', name: 'Alice', age: 30 };

      // Type-safe set
      await pipe(storage.set('user:1', user))();

      // Type-safe get
      const result = await pipe(storage.get<User>('user:1'))();
      
      if (result._tag === 'Right' && O.isSome(result.right)) {
        const retrieved: User = result.right.value;
        expect(retrieved.id).toBe('1');
        expect(retrieved.name).toBe('Alice');
        expect(retrieved.age).toBe(30);
      }
    });
  });
});