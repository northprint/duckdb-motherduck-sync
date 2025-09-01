/**
 * Error handling utilities
 */

import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import type { TaskEither } from 'fp-ts/TaskEither';
import type { SyncError } from '../types/errors';
import {
  networkError,
  authError,
  unknownError,
  isNetworkError,
  isAuthError,
} from '../types/errors';

// Retry configuration
export interface RetryConfig {
  readonly maxAttempts: number;
  readonly initialDelay: number;
  readonly maxDelay: number;
  readonly backoffFactor: number;
}

export const defaultRetryConfig: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
};

// Calculate exponential backoff delay
export const calculateBackoff = (
  attempt: number,
  config: RetryConfig,
): number => {
  const delay = config.initialDelay * Math.pow(config.backoffFactor, attempt - 1);
  return Math.min(delay, config.maxDelay);
};

// Check if error is retryable
export const isRetryable = (error: SyncError): boolean => {
  if (isNetworkError(error)) {
    return error.retryable;
  }
  if (isAuthError(error)) {
    return error.requiresRefresh;
  }
  return false;
};

// Delay execution
const delay = (ms: number): TaskEither<never, void> =>
  TE.fromTask(() => new Promise((resolve) => setTimeout(resolve, ms)));

// Retry with exponential backoff
export const retryWithBackoff = <A>(
  task: TaskEither<SyncError, A>,
  config: RetryConfig = defaultRetryConfig,
): TaskEither<SyncError, A> => {
  const attempt = (currentAttempt: number): TaskEither<SyncError, A> =>
    pipe(
      task,
      TE.fold(
        (error) => {
          if (currentAttempt >= config.maxAttempts || !isRetryable(error)) {
            return TE.left(error);
          }
          const delayMs = calculateBackoff(currentAttempt, config);
          return pipe(
            delay(delayMs),
            TE.chain(() => attempt(currentAttempt + 1)),
          );
        },
        TE.of,
      ),
    );

  return attempt(1);
};

// Convert unknown errors to SyncError
export const toSyncError = (error: unknown): SyncError => {
  // If it's already a SyncError, return it as-is
  if (error && typeof error === 'object' && 'type' in error && 'errorType' in error) {
    return error as unknown as SyncError;
  }
  
  if (error instanceof Error) {
    // Check for network errors
    if (error.name === 'NetworkError' || error.message.toLowerCase().includes('network')) {
      return networkError(error.message, true);
    }
    // Check for auth errors
    if (error.name === 'AuthError' || error.message.toLowerCase().includes('auth')) {
      return authError(error.message, true);
    }
    // Default to unknown error
    return unknownError(error.message, error);
  }
  return unknownError('Unknown error occurred', error);
};

// Error logging
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  readonly log: (level: LogLevel, message: string, context?: Record<string, unknown>) => void;
}

export const consoleLogger: Logger = {
  log: (level, message, context) => {
    // Skip all logs in test environment if LOG_LEVEL is not set
    if (process.env['NODE_ENV'] === 'test' && !process.env['LOG_LEVEL']) {
      return;
    }
    
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    switch (level) {
      case 'error':
        console.error(logMessage, context);
        break;
      case 'warn':
        console.warn(logMessage, context);
        break;
      default:
        // console.log for debug and info
        if (level === 'debug' && process.env['NODE_ENV'] === 'production') {
          return; // Skip debug logs in production
        }
        console.log(logMessage, context);
    }
  },
};

// Log error with context
export const logError = (
  logger: Logger,
  error: SyncError,
  context?: Record<string, unknown>,
): void => {
  const errorContext = {
    ...context,
    errorType: error.type,
    timestamp: error.timestamp,
    ...(error.context || {}),
  };

  logger.log('error', error.message, errorContext);
};

// Wrap task with error handling and logging
export const withErrorHandling = <A>(
  task: TaskEither<unknown, A>,
  logger: Logger = consoleLogger,
  context?: Record<string, unknown>,
): TaskEither<SyncError, A> =>
  pipe(
    task as TaskEither<SyncError, A>,
    TE.mapLeft((error) => {
      const syncError = toSyncError(error);
      logError(logger, syncError, context);
      return syncError;
    }),
  );

// Create a typed error
export const createError = <E extends SyncError>(error: E): TaskEither<E, never> =>
  TE.left(error);