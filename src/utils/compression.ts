/**
 * Data compression utilities
 */

import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import type { TaskEither } from 'fp-ts/TaskEither';
import pako from 'pako';
import type { SyncError } from '../types/errors';
import { unknownError } from '../types/errors';

// Compression options
export interface CompressionOptions {
  readonly level?: number; // 0-9, default 6
  readonly threshold?: number; // Minimum size in bytes to compress
}

const defaultOptions: CompressionOptions = {
  level: 6,
  threshold: 1024, // 1KB
};

// Compress data
export const compressData = (
  data: string | Uint8Array,
  options: CompressionOptions = defaultOptions,
): TaskEither<SyncError, Uint8Array> =>
  TE.tryCatch(
    async () => {
      const input = typeof data === 'string' 
        ? new TextEncoder().encode(data)
        : data;

      // Skip compression for small data
      const threshold = options.threshold ?? defaultOptions.threshold!;
      if (input.length < threshold) {
        return input;
      }

      return pako.gzip(input, { level: options.level as pako.DeflateOptions['level'] });
    },
    (error) => unknownError('Compression failed', error),
  );

// Decompress data
export const decompressData = (
  data: Uint8Array,
): TaskEither<SyncError, Uint8Array> =>
  TE.tryCatch(
    async () => {
      // Check if data is gzipped (magic number: 1f 8b)
      if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
        return pako.ungzip(data);
      }
      // Return as-is if not compressed
      return data;
    },
    (error) => unknownError('Decompression failed', error),
  );

// Compress JSON data
export const compressJson = <T>(
  data: T,
  options?: CompressionOptions,
): TaskEither<SyncError, Uint8Array> =>
  pipe(
    TE.tryCatch(
      async () => JSON.stringify(data),
      (error) => unknownError('JSON serialization failed', error),
    ),
    TE.chain((json) => compressData(json, options)),
  );

// Decompress JSON data
export const decompressJson = <T = unknown>(
  data: Uint8Array,
): TaskEither<SyncError, T> =>
  pipe(
    decompressData(data),
    TE.chain((decompressed) =>
      TE.tryCatch(
        async () => {
          const text = new TextDecoder().decode(decompressed);
          return JSON.parse(text) as T;
        },
        (error): SyncError => unknownError('JSON deserialization failed', error),
      ),
    ),
  );

// Calculate compression ratio
export const calculateCompressionRatio = (
  original: number,
  compressed: number,
): number => {
  if (original === 0) return 0;
  return Math.round((1 - compressed / original) * 100);
};