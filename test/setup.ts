/**
 * Test setup file
 */

import { beforeAll, afterAll, afterEach } from 'vitest';

// Mock IndexedDB for tests
import 'fake-indexeddb/auto';

// Global test setup
beforeAll(() => {
  // Setup any global test state
  console.log('Starting test suite...');
});

// Cleanup after each test
afterEach(() => {
  // Clear any test data
});

// Global test teardown
afterAll(() => {
  // Cleanup any global test state
  console.log('Test suite completed.');
});

// Mock Web Worker API if not available
if (typeof Worker === 'undefined') {
  (global as any).Worker = class MockWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((error: ErrorEvent) => void) | null = null;

    postMessage(message: any): void {
      // Mock implementation
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage(new MessageEvent('message', { data: message }));
        }
      }, 0);
    }

    terminate(): void {
      // Mock implementation
    }
  };
}

// Mock navigator.onLine if not available
if (typeof navigator === 'undefined') {
  (global as any).navigator = {
    onLine: true,
    connection: {
      effectiveType: '4g',
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  };
}