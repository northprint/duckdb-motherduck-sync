/**
 * Tests for MotherDuck adapter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pipe } from 'fp-ts/function';
import { createMockMotherDuckClient, createMotherDuckClient } from './motherduck';
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

  describe('Real MotherDuck Client', () => {
    // Mock fetch globally
    const mockFetch = vi.fn();
    beforeEach(() => {
      globalThis.fetch = mockFetch as typeof globalThis.fetch;
      mockFetch.mockClear();
    });

    it('should create client with default config', () => {
      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
      });
      
      expect(client).toHaveProperty('authenticate');
      expect(client).toHaveProperty('executeSql');
      expect(client).toHaveProperty('uploadData');
      expect(client).toHaveProperty('downloadData');
    });

    it('should authenticate successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const client = createMotherDuckClient({
        token: 'old-token',
        apiUrl: 'https://api.test.com',
      });

      const result = await pipe(client.authenticate('new-token'))();
      
      expect(result._tag).toBe('Right');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/auth/validate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer new-token',
          }),
        })
      );
    });

    it('should handle authentication failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
      });

      const result = await pipe(client.authenticate('bad-token'))();
      
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('auth-error');
      }
    });

    it('should execute SQL queries', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [{ id: 1, name: 'Test' }],
          metadata: { count: 1, hasMore: false },
        }),
      });

      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
      });

      const result = await pipe(client.executeSql('SELECT * FROM users'))();
      
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right.rows).toHaveLength(1);
        expect(result.right.metadata.count).toBe(1);
      }
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/query',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ sql: 'SELECT * FROM users' }),
        })
      );
    });

    it('should handle query errors with API error format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      });

      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
      });

      const result = await pipe(client.executeSql('BAD SQL'))();
      
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('unknown-error');
        expect(result.left.message).toBe('Failed to parse response');
      }
    });

    it('should upload data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
      });

      const data: DbRecord[] = [
        { id: '1', name: 'Test' },
        { id: '2', name: 'Test2' },
      ];

      const result = await pipe(client.uploadData('users', data))();
      
      expect(result._tag).toBe('Right');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/tables/users/data',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ records: data }),
        })
      );
    });

    it('should handle upload failures', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 413,
      });

      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
      });

      const result = await pipe(client.uploadData('users', []))();
      
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('network-error');
        expect(result.left.message).toContain('Failed to upload data');
      }
    });

    it('should download data with since parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [{ id: '3', name: 'New' }],
          metadata: { count: 1, hasMore: false },
        }),
      });

      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
      });

      const result = await pipe(client.downloadData('users', 1000))();
      
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(1);
      }
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/tables/users/data?since=1000',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should handle network timeouts', async () => {
      // Simulate abort
      mockFetch.mockImplementationOnce((_url: string, _options?: any) => {
        return new Promise((_, reject) => {
          setTimeout(() => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          }, 10);
        });
      });

      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
        timeout: 5000,
      });

      const result = await pipe(client.executeSql('SELECT 1'))();
      
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('network-error');
        expect(result.left.message).toBe('Request timeout');
      }
    });

    it('should handle general network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failed'));

      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
      });

      const result = await pipe(client.executeSql('SELECT 1'))();
      
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('network-error');
        expect(result.left.message).toBe('Network failed');
      }
    });

    it('should handle non-Error thrown values', async () => {
      mockFetch.mockRejectedValueOnce('String error');

      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
      });

      const result = await pipe(client.executeSql('SELECT 1'))();
      
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('unknown-error');
        expect(result.left.message).toBe('Network request failed');
      }
    });

    it('should handle invalid JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
      });

      const result = await pipe(client.executeSql('SELECT 1'))();
      
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('unknown-error');
        expect(result.left.message).toBe('Failed to parse response');
      }
    });

    it('should handle validation errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          // Invalid structure - missing required fields
          data: 'invalid',
        }),
      });

      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
      });

      const result = await pipe(client.executeSql('SELECT 1'))();
      
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('unknown-error');
      }
    });

    it('should handle non-ok response without valid error format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Service unavailable' }), // Not matching ApiErrorCodec
      });

      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
      });

      const result = await pipe(client.executeSql('SELECT 1'))();
      
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.type).toBe('unknown-error');
        expect(result.left.message).toBe('Failed to parse response');
      }
    });

    it('should include correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [], metadata: { count: 0, hasMore: false } }),
      });

      const client = createMotherDuckClient({
        token: 'test-token',
        apiUrl: 'https://api.test.com',
      });

      await pipe(client.executeSql('SELECT 1'))();
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
            'User-Agent': 'duckdb-motherduck-sync/0.1.0',
          }),
        })
      );
    });

    it('should update auth token after successful authentication', async () => {
      // First auth succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });
      // Then a query with new token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [], metadata: { count: 0, hasMore: false } }),
      });

      const client = createMotherDuckClient({
        token: 'old-token',
        apiUrl: 'https://api.test.com',
      });

      // Authenticate with new token
      await pipe(client.authenticate('new-token'))();
      
      // Execute query should use new token
      await pipe(client.executeSql('SELECT 1'))();
      
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer new-token',
          }),
        })
      );
    });
  });
});