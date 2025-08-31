/**
 * Tests for table filtering
 */

import { describe, it, expect } from 'vitest';
import {
  createTableFilter,
  filterChangesByTable,
  commonFilters,
  filterTablesByMetadata,
  metadataFilters,
} from './table-filter';
import type { Change } from '../types';

describe('Table Filter', () => {
  describe('createTableFilter', () => {
    it('should include all tables by default', () => {
      const filter = createTableFilter({});

      expect(filter('users')).toBe(true);
      expect(filter('products')).toBe(true);
      expect(filter('_internal')).toBe(true);
    });

    it('should filter by include list', () => {
      const filter = createTableFilter({
        includeTables: ['users', 'products'],
      });

      expect(filter('users')).toBe(true);
      expect(filter('products')).toBe(true);
      expect(filter('orders')).toBe(false);
    });

    it('should filter by exclude list', () => {
      const filter = createTableFilter({
        excludeTables: ['logs', 'temp'],
      });

      expect(filter('users')).toBe(true);
      expect(filter('logs')).toBe(false);
      expect(filter('temp')).toBe(false);
    });

    it('should filter by include patterns', () => {
      const filter = createTableFilter({
        includePatterns: [/^user_/, /^product_/],
      });

      expect(filter('user_profiles')).toBe(true);
      expect(filter('product_catalog')).toBe(true);
      expect(filter('order_items')).toBe(false);
    });

    it('should filter by exclude patterns', () => {
      const filter = createTableFilter({
        excludePatterns: [/^_/, /^tmp_/],
      });

      expect(filter('users')).toBe(true);
      expect(filter('_internal')).toBe(false);
      expect(filter('tmp_cache')).toBe(false);
    });

    it('should prioritize excludes over includes', () => {
      const filter = createTableFilter({
        includeTables: ['users', 'logs'],
        excludeTables: ['logs'],
      });

      expect(filter('users')).toBe(true);
      expect(filter('logs')).toBe(false);
    });
  });

  describe('filterChangesByTable', () => {
    it('should filter changes by table name', () => {
      const changes: Change[] = [
        {
          id: '1',
          table: 'users',
          operation: 'INSERT',
          data: { id: '1' },
          timestamp: 1000,
        },
        {
          id: '2',
          table: 'logs',
          operation: 'INSERT',
          data: { id: '2' },
          timestamp: 2000,
        },
        {
          id: '3',
          table: 'products',
          operation: 'UPDATE',
          data: { id: '3' },
          timestamp: 3000,
        },
      ];

      const filter = createTableFilter({
        includeTables: ['users', 'products'],
      });

      const filtered = filterChangesByTable(changes, filter);

      expect(filtered).toHaveLength(2);
      expect(filtered[0]?.table).toBe('users');
      expect(filtered[1]?.table).toBe('products');
    });
  });

  describe('commonFilters', () => {
    it('should exclude system tables', () => {
      const config = commonFilters.excludeSystemTables();
      const filter = createTableFilter(config);

      expect(filter('users')).toBe(true);
      expect(filter('_sync_log')).toBe(false);
      expect(filter('sys_config')).toBe(false);
      expect(filter('pg_catalog')).toBe(false);
    });

    it('should only include specific tables', () => {
      const config = commonFilters.onlyTables('users', 'products');
      const filter = createTableFilter(config);

      expect(filter('users')).toBe(true);
      expect(filter('products')).toBe(true);
      expect(filter('orders')).toBe(false);
    });

    it('should exclude specific tables', () => {
      const config = commonFilters.exceptTables('logs', 'temp');
      const filter = createTableFilter(config);

      expect(filter('users')).toBe(true);
      expect(filter('logs')).toBe(false);
    });

    it('should match pattern', () => {
      const config = commonFilters.matchingPattern(/^active_/);
      const filter = createTableFilter(config);

      expect(filter('active_users')).toBe(true);
      expect(filter('inactive_users')).toBe(false);
    });

    it('should combine filters', () => {
      const config = commonFilters.combine(
        commonFilters.excludeSystemTables(),
        commonFilters.onlyTables('users', 'products'),
      );
      const filter = createTableFilter(config);

      expect(filter('users')).toBe(true);
      expect(filter('_internal')).toBe(false);
      expect(filter('orders')).toBe(false);
    });
  });

  describe('filterTablesByMetadata', () => {
    const tables = [
      { name: 'users', rowCount: 1000, sizeBytes: 1024 * 1024 },
      { name: 'logs', rowCount: 1000000, sizeBytes: 100 * 1024 * 1024 },
      { name: 'products', rowCount: 500, sizeBytes: 512 * 1024 },
    ];

    it('should filter by row count', () => {
      const filtered = filterTablesByMetadata(
        tables,
        metadataFilters.smallTables(5000),
      );

      expect(filtered).toEqual(['users', 'products']);
    });

    it('should filter by size', () => {
      const filtered = filterTablesByMetadata(
        tables,
        metadataFilters.withinSizeLimit(10), // 10MB
      );

      expect(filtered).toEqual(['users', 'products']);
    });

    it('should filter by last modified', () => {
      const tablesWithTime = [
        { name: 'recent', lastModified: Date.now() - 1000 },
        { name: 'old', lastModified: Date.now() - 100000 },
      ];

      const filtered = filterTablesByMetadata(
        tablesWithTime,
        metadataFilters.recentlyModified(Date.now() - 10000),
      );

      expect(filtered).toEqual(['recent']);
    });
  });
});