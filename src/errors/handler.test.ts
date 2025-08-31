/**
 * Tests for error handler
 */

import { describe, it, expect, vi } from 'vitest';
import * as TE from 'fp-ts/TaskEither';
import { pipe } from 'fp-ts/function';
import {
  calculateBackoff,
  isRetryable,
  retryWithBackoff,
  toSyncError,
  logError,
  withErrorHandling,
  type RetryConfig,
} from './handler';
import {
  networkError,
  authError,
  unknownError,
  validationError,
} from '../types/errors';

describe('Error Handler', () => {
  describe('calculateBackoff', () => {
    it('should calculate exponential backoff correctly', () => {
      const config: RetryConfig = {
        maxAttempts: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        backoffFactor: 2,
      };

      expect(calculateBackoff(1, config)).toBe(1000);
      expect(calculateBackoff(2, config)).toBe(2000);
      expect(calculateBackoff(3, config)).toBe(4000);
      expect(calculateBackoff(4, config)).toBe(8000);
    });

    it('should respect max delay', () => {
      const config: RetryConfig = {
        maxAttempts: 5,
        initialDelay: 1000,
        maxDelay: 5000,
        backoffFactor: 3,
      };

      expect(calculateBackoff(1, config)).toBe(1000);
      expect(calculateBackoff(2, config)).toBe(3000);
      expect(calculateBackoff(3, config)).toBe(5000); // Capped at maxDelay
      expect(calculateBackoff(4, config)).toBe(5000); // Still capped
    });
  });

  describe('isRetryable', () => {
    it('should identify retryable network errors', () => {
      const retryableError = networkError('Connection failed', true);
      const nonRetryableError = networkError('Bad request', false);

      expect(isRetryable(retryableError)).toBe(true);
      expect(isRetryable(nonRetryableError)).toBe(false);
    });

    it('should identify retryable auth errors', () => {
      const retryableError = authError('Token expired', true);
      const nonRetryableError = authError('Invalid credentials', false);

      expect(isRetryable(retryableError)).toBe(true);
      expect(isRetryable(nonRetryableError)).toBe(false);
    });

    it('should mark other errors as non-retryable', () => {
      const validationErr = validationError('Invalid data', []);
      const unknownErr = unknownError('Something went wrong', new Error());

      expect(isRetryable(validationErr)).toBe(false);
      expect(isRetryable(unknownErr)).toBe(false);
    });
  });

  describe('retryWithBackoff', () => {
    it('should retry on retryable errors', async () => {
      let attempts = 0;
      const task = TE.tryCatch(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('network error');
          }
          return 'success';
        },
        (error) => networkError(String(error), true),
      );

      const config: RetryConfig = {
        maxAttempts: 3,
        initialDelay: 10,
        maxDelay: 100,
        backoffFactor: 2,
      };

      const result = await pipe(retryWithBackoff(task, config))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toBe('success');
      }
      expect(attempts).toBe(3);
    });

    it('should not retry on non-retryable errors', async () => {
      let attempts = 0;
      const task = TE.tryCatch(
        async () => {
          attempts++;
          throw new Error('validation error');
        },
        () => validationError('Invalid input', []),
      );

      const config: RetryConfig = {
        maxAttempts: 3,
        initialDelay: 10,
        maxDelay: 100,
        backoffFactor: 2,
      };

      const result = await pipe(retryWithBackoff(task, config))();

      expect(result._tag).toBe('Left');
      expect(attempts).toBe(1); // Only one attempt
    });

    it('should respect max attempts', async () => {
      let attempts = 0;
      const task = TE.tryCatch(
        async () => {
          attempts++;
          throw new Error('network error');
        },
        (error) => networkError(String(error), true),
      );

      const config: RetryConfig = {
        maxAttempts: 2,
        initialDelay: 10,
        maxDelay: 100,
        backoffFactor: 2,
      };

      const result = await pipe(retryWithBackoff(task, config))();

      expect(result._tag).toBe('Left');
      expect(attempts).toBe(2);
    });
  });

  describe('toSyncError', () => {
    it('should convert network errors', () => {
      const error = new Error('NetworkError: Failed to fetch');
      const syncError = toSyncError(error);

      expect(syncError.type).toBe('network-error');
      expect(syncError.message).toBe('NetworkError: Failed to fetch');
    });

    it('should convert auth errors', () => {
      const error = new Error('AuthError: Invalid token');
      const syncError = toSyncError(error);

      expect(syncError.type).toBe('auth-error');
      expect(syncError.message).toBe('AuthError: Invalid token');
    });

    it('should handle unknown errors', () => {
      const error = { some: 'object' };
      const syncError = toSyncError(error);

      expect(syncError.type).toBe('unknown-error');
      expect(syncError.message).toBe('Unknown error occurred');
    });
  });

  describe('logError', () => {
    it('should log errors with context', () => {
      const mockLogger = {
        log: vi.fn(),
      };

      const error = networkError('Connection failed', true, 500);
      const context = { operation: 'sync', table: 'users' };

      logError(mockLogger, error, context);

      expect(mockLogger.log).toHaveBeenCalledWith(
        'error',
        'Connection failed',
        expect.objectContaining({
          operation: 'sync',
          table: 'users',
          errorType: 'network-error',
          timestamp: expect.any(Number),
        }),
      );
    });
  });

  describe('withErrorHandling', () => {
    it('should handle and log errors', async () => {
      const mockLogger = {
        log: vi.fn(),
      };

      const failingTask = TE.tryCatch(
        async () => {
          throw new Error('Test error');
        },
        (e) => e,
      );

      const result = await pipe(
        withErrorHandling(failingTask, mockLogger, { test: true }),
      )();

      expect(result._tag).toBe('Left');
      expect(mockLogger.log).toHaveBeenCalled();
    });

    it('should pass through successful results', async () => {
      const mockLogger = {
        log: vi.fn(),
      };

      const successTask = TE.of('success');

      const result = await pipe(withErrorHandling(successTask, mockLogger))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toBe('success');
      }
      expect(mockLogger.log).not.toHaveBeenCalled();
    });
  });
});