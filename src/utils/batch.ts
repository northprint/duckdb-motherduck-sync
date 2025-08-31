/**
 * Batch processing utilities for performance optimization
 */

import { pipe } from 'fp-ts/function';
import * as A from 'fp-ts/Array';
import * as TE from 'fp-ts/TaskEither';
import type { TaskEither } from 'fp-ts/TaskEither';
import type { SyncError } from '../types/errors';

// Batch processing options
export interface BatchOptions {
  readonly batchSize: number;
  readonly concurrency: number;
  readonly delayBetweenBatches?: number; // ms
}

const defaultBatchOptions: BatchOptions = {
  batchSize: 1000,
  concurrency: 3,
  delayBetweenBatches: 0,
};

// Process items in batches
export const processBatch = <A, B>(
  items: ReadonlyArray<A>,
  processor: (batch: ReadonlyArray<A>) => TaskEither<SyncError, ReadonlyArray<B>>,
  options: BatchOptions = defaultBatchOptions,
): TaskEither<SyncError, ReadonlyArray<B>> => {
  if (items.length === 0) {
    return TE.of([]);
  }

  // Split items into batches
  const batches = chunkArray(items, options.batchSize);
  
  // Process batches with controlled concurrency
  return pipe(
    batches,
    A.chunksOf(options.concurrency),
    A.traverse(TE.ApplicativeSeq)((concurrentBatches) =>
      pipe(
        concurrentBatches,
        A.traverse(TE.ApplicativePar)(processor),
        TE.map(A.flatten),
        TE.chainFirst(() =>
          options.delayBetweenBatches && options.delayBetweenBatches > 0
            ? delay(options.delayBetweenBatches)
            : TE.of(undefined),
        ),
      ),
    ),
    TE.map(A.flatten),
  );
};

// Process items with rate limiting
export const processWithRateLimit = <A, B>(
  items: ReadonlyArray<A>,
  processor: (item: A) => TaskEither<SyncError, B>,
  itemsPerSecond: number,
): TaskEither<SyncError, ReadonlyArray<B>> => {
  const delayMs = Math.ceil(1000 / itemsPerSecond);
  
  return pipe(
    items,
    A.traverse(TE.ApplicativeSeq)((item) =>
      pipe(
        processor(item),
        TE.chainFirst(() => delay(delayMs)),
      ),
    ),
  );
};

// Chunk array into smaller arrays
export const chunkArray = <A>(
  array: ReadonlyArray<A>,
  size: number,
): ReadonlyArray<ReadonlyArray<A>> => {
  if (size <= 0 || array.length === 0) {
    return [];
  }
  
  const chunks: A[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size) as A[]);
  }
  
  return chunks;
};

// Calculate optimal batch size based on item size and memory limit
export const calculateOptimalBatchSize = (
  itemSizeBytes: number,
  memoryLimitMB: number = 100,
  safetyFactor: number = 0.8,
): number => {
  const memoryLimitBytes = memoryLimitMB * 1024 * 1024;
  const safeMemoryLimit = memoryLimitBytes * safetyFactor;
  const optimalSize = Math.floor(safeMemoryLimit / itemSizeBytes);
  
  // Ensure batch size is reasonable
  if (optimalSize < 10) {
    return 10;
  }
  if (optimalSize > 10000) {
    return 10000;
  }
  return optimalSize;
};

// Estimate size of an object in bytes (rough approximation)
export const estimateObjectSize = (obj: unknown): number => {
  const jsonString = JSON.stringify(obj);
  // Rough estimate: 2 bytes per character in memory
  return jsonString.length * 2;
};

// Create batched processor with automatic size calculation
export const createBatchProcessor = <A, B>(
  processor: (batch: ReadonlyArray<A>) => TaskEither<SyncError, ReadonlyArray<B>>,
  memoryLimitMB?: number,
  options?: Partial<BatchOptions>,
): ((items: ReadonlyArray<A>) => TaskEither<SyncError, ReadonlyArray<B>>) => {
  return (items: ReadonlyArray<A>) => {
    // Calculate batch size if not provided
    let batchSize = options?.batchSize;
    
    if (!batchSize && items.length > 0 && memoryLimitMB) {
      const sampleSize = Math.min(10, items.length);
      const sampleItems = items.slice(0, sampleSize);
      const avgSize = sampleItems.reduce((sum, item) => 
        sum + estimateObjectSize(item), 0
      ) / sampleSize;
      
      batchSize = calculateOptimalBatchSize(avgSize, memoryLimitMB);
    }
    
    const finalOptions: BatchOptions = {
      batchSize: batchSize || defaultBatchOptions.batchSize,
      concurrency: options?.concurrency || defaultBatchOptions.concurrency,
      delayBetweenBatches: options?.delayBetweenBatches,
    };
    
    return processBatch(items, processor, finalOptions);
  };
};

// Helper: delay execution
const delay = (ms: number): TaskEither<SyncError, void> =>
  TE.fromTask(() => new Promise((resolve) => setTimeout(resolve, ms)));