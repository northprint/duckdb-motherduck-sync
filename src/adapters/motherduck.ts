/**
 * MotherDuck API adapter
 */

import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import * as E from 'fp-ts/Either';
import type { TaskEither } from 'fp-ts/TaskEither';
import { networkError, authError, unknownError } from '../types/errors';
import type { SyncError } from '../types/errors';
import type { DbRecord, QueryResult } from '../types';
import { validate, QueryResultCodec, ApiErrorCodec } from '../types/schemas';

// MotherDuck API client interface
export interface MotherDuckClient {
  readonly authenticate: (token: string) => TaskEither<SyncError, void>;
  readonly executeSql: (sql: string) => TaskEither<SyncError, QueryResult>;
  readonly uploadData: (table: string, data: ReadonlyArray<DbRecord>) => TaskEither<SyncError, void>;
  readonly downloadData: (table: string, since?: number) => TaskEither<SyncError, ReadonlyArray<DbRecord>>;
}

// MotherDuck configuration
export interface MotherDuckConfig {
  readonly apiUrl: string;
  readonly token: string;
  readonly timeout?: number;
}

const defaultConfig: Partial<MotherDuckConfig> = {
  apiUrl: 'https://api.motherduck.com/v1',
  timeout: 30000,
};

// HTTP request helper
const fetchWithTimeout = (
  url: string,
  options: RequestInit,
  timeout: number,
): TaskEither<SyncError, Response> =>
  TE.tryCatch(
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });
        return response;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    (error) => {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return networkError('Request timeout', true);
        }
        return networkError(error.message, true);
      }
      return unknownError('Network request failed', error);
    },
  );

// Parse API response
const parseResponse = <T>(
  response: Response,
  codec: typeof QueryResultCodec,
): TaskEither<SyncError, T> =>
  TE.tryCatch(
    async () => {
      if (!response.ok) {
        const errorData = await response.json();
        const apiError = validate(ApiErrorCodec)(errorData);
        
        if (E.isRight(apiError)) {
          if (response.status === 401) {
            throw authError(apiError.right.error, true);
          }
          throw networkError(apiError.right.error, response.status >= 500);
        }
        
        throw networkError(`HTTP ${response.status}`, response.status >= 500, response.status);
      }

      const data = await response.json();
      const validated = validate(codec)(data);
      
      if (E.isLeft(validated)) {
        throw validated.left;
      }
      
      return validated.right as T;
    },
    (error) => {
      if (error instanceof Error) {
        if ('type' in error && 'timestamp' in error && 'message' in error) {
          return error as unknown as SyncError;
        }
      }
      return unknownError('Failed to parse response', error);
    },
  );

// Create MotherDuck API client
export const createMotherDuckClient = (
  config: MotherDuckConfig,
): MotherDuckClient => {
  const fullConfig = { ...defaultConfig, ...config };
  let authToken = config.token;

  const headers = (): HeadersInit => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
    'User-Agent': 'duckdb-motherduck-sync/0.1.1',
  });

  return {
    authenticate: (token: string) =>
      pipe(
        fetchWithTimeout(
          `${fullConfig.apiUrl}/auth/validate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
          },
          fullConfig.timeout!,
        ),
        TE.chain((response) => {
          if (response.ok) {
            authToken = token;
            return TE.of(undefined);
          }
          return TE.left(authError('Invalid token', false));
        }),
      ),

    executeSql: (sql: string) =>
      pipe(
        fetchWithTimeout(
          `${fullConfig.apiUrl}/query`,
          {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ sql }),
          },
          fullConfig.timeout!,
        ),
        TE.chain((response) => parseResponse<QueryResult>(response, QueryResultCodec)),
      ),

    uploadData: (table: string, data: ReadonlyArray<DbRecord>) =>
      pipe(
        fetchWithTimeout(
          `${fullConfig.apiUrl}/tables/${table}/data`,
          {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ records: data }),
          },
          fullConfig.timeout!,
        ),
        TE.chain((response) => {
          if (response.ok) {
            return TE.of(undefined);
          }
          return TE.left(
            networkError(`Failed to upload data: HTTP ${response.status}`, true, response.status),
          );
        }),
      ),

    downloadData: (table: string, since?: number) =>
      pipe(
        fetchWithTimeout(
          `${fullConfig.apiUrl}/tables/${table}/data${since ? `?since=${since}` : ''}`,
          {
            method: 'GET',
            headers: headers(),
          },
          fullConfig.timeout!,
        ),
        TE.chain((response) => parseResponse<QueryResult>(response, QueryResultCodec)),
        TE.map((result) => result.rows),
      ),
  };
};

// Create MotherDuck adapter (alias for createMotherDuckClient)
export const createMotherDuckAdapter = createMotherDuckClient;

// Create mock client for testing
export const createMockMotherDuckClient = (): MotherDuckClient => {
  const mockData = new Map<string, DbRecord[]>();

  return {
    authenticate: (token: string) =>
      token === 'valid-token'
        ? TE.of(undefined)
        : TE.left(authError('Invalid token', false)),

    executeSql: (_sql: string) =>
      TE.of({
        rows: mockData.get('query') || [],
        metadata: { count: 0, hasMore: false },
      }),

    uploadData: (table: string, data: ReadonlyArray<DbRecord>) => {
      const existing = mockData.get(table) || [];
      mockData.set(table, [...existing, ...data]);
      return TE.of(undefined);
    },

    downloadData: (table: string, since?: number) => {
      const data = mockData.get(table) || [];
      if (since) {
        return TE.of(
          data.filter((row) => {
            const timestamp = row['updated_at'] || row['created_at'];
            return typeof timestamp === 'number' && timestamp > since;
          }),
        );
      }
      return TE.of(data);
    },
  };
};