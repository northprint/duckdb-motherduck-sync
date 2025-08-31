/**
 * Tests for MotherDuck adapter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { pipe } from 'fp-ts/function';
import * as E from 'fp-ts/Either';
import { createMockMotherDuckClient } from './motherduck';
import type { MotherDuckClient } from './motherduck';
import type { DbRecord } from '../types';

describe('MotherDuck Adapter', () => {
  describe('Mock Client', () => {
    let client: MotherDuckClient;

    beforeEach(() => {
      client = createMockMotherDuckClient();
    });

    it('should authenticate with valid token', async () => {
      const result = await pipe(client.authenticate('valid-token'))();
      expect(result._tag).toBe('Right');
    });

    it('should reject invalid token', async () => {
      const result = await pipe(client.authenticate('invalid-token'))();
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('auth-error');
      }
    });

    it('should upload and download data', async () => {
      const testData: DbRecord[] = [
        { id: '1', name: 'Test 1', created_at: 1000 },
        { id: '2', name: 'Test 2', created_at: 2000 },
      ];

      // Upload data
      const uploadResult = await pipe(
        client.uploadData('test_table', testData),
      )();
      expect(uploadResult._tag).toBe('Right');

      // Download data
      const downloadResult = await pipe(
        client.downloadData('test_table'),
      )();
      expect(downloadResult._tag).toBe('Right');
      if (downloadResult._tag === 'Right') {
        expect(downloadResult.right).toHaveLength(2);
        expect(downloadResult.right).toEqual(testData);
      }
    });

    it('should filter data by timestamp', async () => {
      const testData: DbRecord[] = [
        { id: '1', name: 'Old', updated_at: 1000 },
        { id: '2', name: 'New', updated_at: 3000 },
      ];

      await pipe(client.uploadData('timestamps', testData))();

      // Get data after timestamp 2000
      const result = await pipe(
        client.downloadData('timestamps', 2000),
      )();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(1);
        expect(result.right[0]?.name).toBe('New');
      }
    });

    it('should execute SQL queries', async () => {
      const result = await pipe(
        client.executeSql('SELECT * FROM test'),
      )();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveProperty('rows');
        expect(result.right).toHaveProperty('metadata');
        expect(result.right.metadata.hasMore).toBe(false);
      }
    });

    it('should handle empty results', async () => {
      const result = await pipe(
        client.downloadData('empty_table'),
      )();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(0);
      }
    });

    it('should accumulate multiple uploads', async () => {
      const batch1: DbRecord[] = [{ id: '1', value: 'first' }];
      const batch2: DbRecord[] = [{ id: '2', value: 'second' }];

      await pipe(client.uploadData('accumulate', batch1))();
      await pipe(client.uploadData('accumulate', batch2))();

      const result = await pipe(client.downloadData('accumulate'))();
      
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(2);
      }
    });
  });

  describe('Error handling', () => {
    it('should handle authentication errors', async () => {
      const client = createMockMotherDuckClient();
      const result = await pipe(client.authenticate(''))();

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('auth-error');
        expect(result.left.message).toContain('Invalid token');
      }
    });
  });
});