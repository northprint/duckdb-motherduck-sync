/**
 * Tests for batch processing utilities
 */

import { describe, it, expect } from 'vitest';
import { pipe } from 'fp-ts/function';
import * as TE from 'fp-ts/TaskEither';
import {
  chunkArray,
  processBatch,
  processWithRateLimit,
  calculateOptimalBatchSize,
  estimateObjectSize,
  createBatchProcessor,
} from './batch';
import type { SyncError } from '../types/errors';

describe('Batch Processing', () => {
  describe('chunkArray', () => {
    it('should split array into chunks', () => {
      const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const chunks = chunkArray(array, 3);

      expect(chunks).toHaveLength(4);
      expect(chunks[0]).toEqual([1, 2, 3]);
      expect(chunks[1]).toEqual([4, 5, 6]);
      expect(chunks[2]).toEqual([7, 8, 9]);
      expect(chunks[3]).toEqual([10]);
    });

    it('should handle empty array', () => {
      expect(chunkArray([], 5)).toEqual([]);
    });

    it('should handle invalid size', () => {
      expect(chunkArray([1, 2, 3], 0)).toEqual([]);
      expect(chunkArray([1, 2, 3], -1)).toEqual([]);
    });

    it('should handle size larger than array', () => {
      const chunks = chunkArray([1, 2, 3], 10);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual([1, 2, 3]);
    });
  });

  describe('processBatch', () => {
    it('should process items in batches', async () => {
      const items = Array.from({ length: 10 }, (_, i) => i);
      const processedBatches: number[][] = [];

      const processor = (batch: ReadonlyArray<number>) =>
        TE.of((() => {
          processedBatches.push([...batch]);
          return batch.map(n => n * 2);
        })());

      const result = await pipe(
        processBatch(items, processor, { batchSize: 3, concurrency: 1 }),
      )();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(10);
        expect(result.right).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
      }

      expect(processedBatches).toHaveLength(4);
      expect(processedBatches[0]).toEqual([0, 1, 2]);
      expect(processedBatches[3]).toEqual([9]);
    });

    it('should handle empty array', async () => {
      const processor = (batch: ReadonlyArray<number>) =>
        TE.of(batch.map(n => n * 2));

      const result = await pipe(processBatch([], processor))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toEqual([]);
      }
    });

    it('should process with concurrency', async () => {
      const items = Array.from({ length: 9 }, (_, i) => i);
      const startTimes: number[] = [];

      const processor = (batch: ReadonlyArray<number>) =>
        TE.fromTask(async () => {
          startTimes.push(Date.now());
          await new Promise(resolve => setTimeout(resolve, 50));
          return batch.map(n => n * 2);
        });

      const start = Date.now();
      const result = await pipe(
        processBatch(items, processor, { 
          batchSize: 3, 
          concurrency: 3,
        }),
      )();

      const duration = Date.now() - start;

      expect(result._tag).toBe('Right');
      // Should process all 3 batches concurrently, taking ~50ms
      expect(duration).toBeLessThan(150);
    });
  });

  describe('processWithRateLimit', () => {
    it('should respect rate limit', async () => {
      const items = [1, 2, 3, 4, 5];
      const processTimes: number[] = [];

      const processor = (n: number) =>
        TE.of((() => {
          processTimes.push(Date.now());
          return n * 2;
        })());

      const start = Date.now();
      const result = await pipe(
        processWithRateLimit(items, processor, 10), // 10 items per second
      )();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toEqual([2, 4, 6, 8, 10]);
      }

      // Check timing - should take at least 400ms for 5 items at 10/sec
      const duration = Date.now() - start;
      expect(duration).toBeGreaterThanOrEqual(400);
    });
  });

  describe('calculateOptimalBatchSize', () => {
    it('should calculate batch size based on memory limit', () => {
      // 1KB per item, 10MB limit
      expect(calculateOptimalBatchSize(1024, 10)).toBe(8192);

      // 1MB per item, 10MB limit (8 would be optimal but min is 10)
      expect(calculateOptimalBatchSize(1024 * 1024, 10)).toBe(10);

      // Very small items
      expect(calculateOptimalBatchSize(10, 100)).toBe(10000); // Max limit

      // Very large items
      expect(calculateOptimalBatchSize(100 * 1024 * 1024, 10)).toBe(10); // Min limit
    });
  });

  describe('estimateObjectSize', () => {
    it('should estimate object size', () => {
      expect(estimateObjectSize({ a: 1 })).toBeGreaterThan(0);
      expect(estimateObjectSize('hello')).toBe(14); // "hello" = 7 chars * 2
      expect(estimateObjectSize([1, 2, 3])).toBeGreaterThan(10);

      const largeObject = { data: 'x'.repeat(1000) };
      const estimate = estimateObjectSize(largeObject);
      expect(estimate).toBeGreaterThan(2000);
    });
  });

  describe('createBatchProcessor', () => {
    it('should create processor with auto batch size', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        data: 'x'.repeat(100),
      }));

      const processor = createBatchProcessor<typeof items[0], number>(
        (batch) => TE.of(batch.map(item => item.id * 2)),
        10, // 10MB limit
      );

      const result = await pipe(processor(items))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toHaveLength(100);
        expect(result.right[0]).toBe(0);
        expect(result.right[99]).toBe(198);
      }
    });

    it('should use provided batch size', async () => {
      let batchCount = 0;
      
      const processor = createBatchProcessor<number, number>(
        (batch) => {
          batchCount++;
          return TE.of(batch.map(n => n * 2));
        },
        undefined,
        { batchSize: 25 },
      );

      const items = Array.from({ length: 100 }, (_, i) => i);
      const result = await pipe(processor(items))();

      expect(result._tag).toBe('Right');
      expect(batchCount).toBe(4); // 100 items / 25 per batch
    });
  });
});