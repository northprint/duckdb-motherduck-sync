/**
 * Error types for sync operations
 */

import type { Conflict } from './base';

// Base error interface
interface BaseError {
  readonly message: string;
  readonly timestamp: number;
  readonly context?: Record<string, unknown>;
}

// Network error
export interface NetworkError extends BaseError {
  readonly type: 'network-error';
  readonly retryable: boolean;
  readonly statusCode?: number;
}

// Authentication error
export interface AuthError extends BaseError {
  readonly type: 'auth-error';
  readonly requiresRefresh: boolean;
}

// Conflict error
export interface ConflictError extends BaseError {
  readonly type: 'conflict-error';
  readonly conflicts: ReadonlyArray<Conflict>;
}

// Quota exceeded error
export interface QuotaError extends BaseError {
  readonly type: 'quota-exceeded';
  readonly limit: number;
  readonly used: number;
}

// Validation error
export interface ValidationError extends BaseError {
  readonly type: 'validation-error';
  readonly field?: string;
  readonly value?: unknown;
  readonly details: ReadonlyArray<ValidationDetail>;
}

export interface ValidationDetail {
  readonly path: string;
  readonly message: string;
}

// Unknown error
export interface UnknownError extends BaseError {
  readonly type: 'unknown-error';
  readonly error: unknown;
}

// Union type for all sync errors
export type SyncError =
  | NetworkError
  | AuthError
  | ConflictError
  | QuotaError
  | ValidationError
  | UnknownError;

// Type guards
export const isNetworkError = (error: SyncError): error is NetworkError =>
  error.type === 'network-error';

export const isAuthError = (error: SyncError): error is AuthError =>
  error.type === 'auth-error';

export const isConflictError = (error: SyncError): error is ConflictError =>
  error.type === 'conflict-error';

export const isQuotaError = (error: SyncError): error is QuotaError =>
  error.type === 'quota-exceeded';

export const isValidationError = (error: SyncError): error is ValidationError =>
  error.type === 'validation-error';

export const isUnknownError = (error: SyncError): error is UnknownError =>
  error.type === 'unknown-error';

// Error constructors
export const networkError = (
  message: string,
  retryable: boolean,
  statusCode?: number,
  context?: Record<string, unknown>,
): NetworkError => ({
  type: 'network-error',
  message,
  retryable,
  statusCode,
  timestamp: Date.now(),
  context,
});

export const authError = (
  message: string,
  requiresRefresh: boolean,
  context?: Record<string, unknown>,
): AuthError => ({
  type: 'auth-error',
  message,
  requiresRefresh,
  timestamp: Date.now(),
  context,
});

export const conflictError = (
  message: string,
  conflicts: ReadonlyArray<Conflict>,
  context?: Record<string, unknown>,
): ConflictError => ({
  type: 'conflict-error',
  message,
  conflicts,
  timestamp: Date.now(),
  context,
});

export const quotaError = (
  message: string,
  limit: number,
  used: number,
  context?: Record<string, unknown>,
): QuotaError => ({
  type: 'quota-exceeded',
  message,
  limit,
  used,
  timestamp: Date.now(),
  context,
});

export const validationError = (
  message: string,
  details: ReadonlyArray<ValidationDetail>,
  field?: string,
  value?: unknown,
  context?: Record<string, unknown>,
): ValidationError => ({
  type: 'validation-error',
  message,
  details,
  field,
  value,
  timestamp: Date.now(),
  context,
});

export const unknownError = (
  message: string,
  error: unknown,
  context?: Record<string, unknown>,
): UnknownError => ({
  type: 'unknown-error',
  message,
  error,
  timestamp: Date.now(),
  context,
});