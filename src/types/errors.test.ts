/**
 * Tests for error types
 */

import { describe, it, expect } from 'vitest';
import {
  networkError,
  authError,
  validationError,
  conflictError,
  unknownError,
  quotaError,
  isNetworkError,
  isAuthError,
  isValidationError,
  isConflictError,
  isUnknownError,
  isQuotaError,
  type SyncError
} from './errors';

describe('Error Types', () => {
  describe('Error Constructors', () => {
    it('should create network error', () => {
      const error = networkError('Connection timeout', true);
      expect(error.type).toBe('network-error');
      expect(error.message).toBe('Connection timeout');
      expect(error.retryable).toBe(true);
      expect(error.timestamp).toBeGreaterThan(0);
    });

    it('should create auth error', () => {
      const error = authError('Invalid token', true);
      expect(error.type).toBe('auth-error');
      expect(error.message).toBe('Invalid token');
      expect(error.requiresRefresh).toBe(true);
    });

    it('should create validation error', () => {
      const error = validationError('Invalid data format', [
        { path: 'email', message: 'Invalid email format' }
      ], 'email', 'not-an-email');
      expect(error.type).toBe('validation-error');
      expect(error.message).toBe('Invalid data format');
      expect(error.details).toHaveLength(1);
      expect(error.details[0].path).toBe('email');
      expect(error.field).toBe('email');
      expect(error.value).toBe('not-an-email');
    });

    it('should create quota error', () => {
      const error = quotaError('Storage limit exceeded', 1000000, 1200000);
      expect(error.type).toBe('quota-exceeded');
      expect(error.message).toBe('Storage limit exceeded');
      expect(error.limit).toBe(1000000);
      expect(error.used).toBe(1200000);
    });

    it('should create conflict error', () => {
      const conflicts = [
        {
          table: 'users',
          key: { id: '1' },
          localValue: { name: 'A' },
          remoteValue: { name: 'B' },
          localTimestamp: 1000,
          remoteTimestamp: 2000
        }
      ];
      const error = conflictError('Merge conflict', conflicts);
      expect(error.type).toBe('conflict-error');
      expect(error.message).toBe('Merge conflict');
      expect(error.conflicts).toHaveLength(1);
    });

    it('should create unknown error with context', () => {
      const originalError = new Error('Original');
      const error = unknownError('Something went wrong', originalError);
      expect(error.type).toBe('unknown-error');
      expect(error.message).toBe('Something went wrong');
      expect(error.error).toBe(originalError);
    });

    it('should create unknown error with undefined', () => {
      const error = unknownError('Unknown issue', undefined);
      expect(error.type).toBe('unknown-error');
      expect(error.message).toBe('Unknown issue');
      expect(error.error).toBeUndefined();
    });
  });

  describe('Type Guards', () => {
    it('should identify network errors', () => {
      const netError = networkError('Timeout', true);
      const authErr = authError('Invalid', false);
      
      expect(isNetworkError(netError)).toBe(true);
      expect(isNetworkError(authErr)).toBe(false);
    });

    it('should identify auth errors', () => {
      const authErr = authError('Invalid', false);
      const netError = networkError('Timeout', true);
      
      expect(isAuthError(authErr)).toBe(true);
      expect(isAuthError(netError)).toBe(false);
    });

    it('should identify validation errors', () => {
      const valError = validationError('Invalid', []);
      const netError = networkError('Timeout', true);
      
      expect(isValidationError(valError)).toBe(true);
      expect(isValidationError(netError)).toBe(false);
    });

    it('should identify quota errors', () => {
      const quotaErr = quotaError('Limit exceeded', 100, 150);
      const netError = networkError('Timeout', true);
      
      expect(isQuotaError(quotaErr)).toBe(true);
      expect(isQuotaError(netError)).toBe(false);
    });

    it('should identify conflict errors', () => {
      const confError = conflictError('Conflict', []);
      const netError = networkError('Timeout', true);
      
      expect(isConflictError(confError)).toBe(true);
      expect(isConflictError(netError)).toBe(false);
    });

    it('should identify unknown errors', () => {
      const unkError = unknownError('Unknown', 'some error');
      const netError = networkError('Timeout', true);
      
      expect(isUnknownError(unkError)).toBe(true);
      expect(isUnknownError(netError)).toBe(false);
    });
  });

  describe('Error Type Union', () => {
    it('should handle all error types in union', () => {
      const errors: SyncError[] = [
        networkError('Network', true),
        authError('Auth', false),
        validationError('Validation', []),
        conflictError('Conflict', []),
        quotaError('Quota', 100, 200),
        unknownError('Unknown', null)
      ];

      errors.forEach(error => {
        expect(error.message).toBeTruthy();
        expect(error.timestamp).toBeGreaterThan(0);
        expect(error.type).toBeTruthy();
      });
    });
  });

  describe('Error Type String Values', () => {
    it('should have correct type strings', () => {
      expect(networkError('test', true).type).toBe('network-error');
      expect(authError('test', true).type).toBe('auth-error');
      expect(validationError('test', []).type).toBe('validation-error');
      expect(conflictError('test', []).type).toBe('conflict-error');
      expect(quotaError('test', 1, 2).type).toBe('quota-exceeded');
      expect(unknownError('test', null).type).toBe('unknown-error');
    });
  });
});