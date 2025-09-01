/**
 * Tests for schema types and validation
 */

import { describe, it, expect } from 'vitest';
import * as E from 'fp-ts/Either';
import {
  DbRecordSchema,
  ChangeSchema,
  SyncStateSchema,
  ConflictSchema,
  SyncConfigSchema,
  validateDbRecord,
  validateChange,
  validateSyncState,
  validateSyncConfig,
  validate,
  DbValueCodec
} from './schemas';

describe('Schema Validation', () => {
  describe('validate helper', () => {
    it('should validate values with codec', () => {
      const result = validate(DbValueCodec)('test');
      expect(E.isRight(result)).toBe(true);
    });

    it('should reject invalid values', () => {
      const result = validate(DbValueCodec)(Symbol('invalid'));
      expect(E.isLeft(result)).toBe(true);
    });
  });

  describe('DbRecordSchema', () => {
    it('should validate correct DbRecord', () => {
      const validRecord = {
        id: '123',
        table: 'users',
        data: { name: 'John', age: 30 },
        timestamp: new Date('2024-01-01'),
        version: 1,
        checksum: 'abc123'
      };

      const result = validateDbRecord(validRecord);
      expect(E.isRight(result)).toBe(true);
    });

    it('should reject invalid DbRecord', () => {
      const invalidRecord = {
        id: 123, // Should be string
        table: 'users'
      };

      const result = validateDbRecord(invalidRecord);
      expect(E.isLeft(result)).toBe(true);
    });
  });

  describe('ChangeSchema', () => {
    it('should validate change', () => {
      const validChange = {
        id: '456',
        type: 'insert',
        table: 'products',
        data: { name: 'Widget' },
        timestamp: new Date('2024-01-02'),
        recordId: 'prod-1'
      };

      const result = validateChange(validChange);
      expect(E.isRight(result)).toBe(true);
    });
  });

  describe('SyncStateSchema', () => {
    it('should validate sync states', () => {
      const idleState = { type: 'idle' };
      const result = validateSyncState(idleState);
      expect(E.isRight(result)).toBe(true);

      const syncingState = {
        type: 'syncing',
        direction: 'push',
        progress: 50
      };
      const result2 = validateSyncState(syncingState);
      expect(E.isRight(result2)).toBe(true);
    });
  });

  describe('SyncConfigSchema', () => {
    it('should validate config', () => {
      const config = {
        motherduckToken: 'test-token',
        tables: ['users', 'products']
      };

      const result = validateSyncConfig(config);
      expect(E.isRight(result)).toBe(true);
    });
  });
});