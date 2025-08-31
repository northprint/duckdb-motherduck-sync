/**
 * Tests for compression utilities
 */

import { describe, it, expect } from 'vitest';
import { pipe } from 'fp-ts/function';
import * as E from 'fp-ts/Either';
import {
  compress,
  decompress,
  compressJson,
  decompressJson,
  calculateCompressionRatio,
} from './compression';

describe('Compression Utilities', () => {
  describe('compress', () => {
    it('should compress string data', async () => {
      const data = 'Hello, World! '.repeat(100);
      const result = await pipe(compress(data))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toBeInstanceOf(Uint8Array);
        expect(result.right.length).toBeLessThan(data.length);
      }
    });

    it('should compress binary data', async () => {
      const data = new Uint8Array(2000).fill(65); // 'A' repeated (increased size)
      const result = await pipe(compress(data))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toBeInstanceOf(Uint8Array);
        // Highly repetitive data should compress well
        expect(result.right.length).toBeLessThan(data.length);
      }
    });

    it('should skip compression for small data', async () => {
      const data = 'Small';
      const result = await pipe(compress(data, { threshold: 100 }))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        // Should return original data as Uint8Array
        const decoded = new TextDecoder().decode(result.right);
        expect(decoded).toBe(data);
      }
    });
  });

  describe('decompress', () => {
    it('should decompress compressed data', async () => {
      const original = 'Hello, World! '.repeat(100);
      const compressed = await pipe(compress(original))();

      expect(compressed._tag).toBe('Right');
      if (compressed._tag === 'Right') {
        const result = await pipe(decompress(compressed.right))();

        if (result._tag === 'Left') {
          console.error('Decompression error:', result.left);
        }
        expect(result._tag).toBe('Right');
        if (result._tag === 'Right') {
          const decoded = new TextDecoder().decode(result.right);
          expect(decoded).toBe(original);
        }
      }
    });

    it('should handle uncompressed data', async () => {
      const data = new TextEncoder().encode('Not compressed');
      const result = await pipe(decompress(data))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toEqual(data);
      }
    });
  });

  describe('compressJson', () => {
    it('should compress JSON data', async () => {
      const data = {
        users: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
        })),
      };

      const result = await pipe(compressJson(data))();

      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        const jsonString = JSON.stringify(data);
        expect(result.right.length).toBeLessThan(jsonString.length);
      }
    });
  });

  describe('decompressJson', () => {
    it('should decompress JSON data', async () => {
      const original = {
        test: 'data',
        numbers: [1, 2, 3, 4, 5],
      };

      const compressed = await pipe(compressJson(original))();

      if (compressed._tag === 'Right') {
        const result = await pipe(decompressJson(compressed.right))();

        expect(result._tag).toBe('Right');
        if (result._tag === 'Right') {
          expect(result.right).toEqual(original);
        }
      }
    });
  });

  describe('calculateCompressionRatio', () => {
    it('should calculate compression ratio', () => {
      expect(calculateCompressionRatio(1000, 300)).toBe(70);
      expect(calculateCompressionRatio(1000, 500)).toBe(50);
      expect(calculateCompressionRatio(1000, 1000)).toBe(0);
    });

    it('should handle zero original size', () => {
      expect(calculateCompressionRatio(0, 0)).toBe(0);
    });
  });
});