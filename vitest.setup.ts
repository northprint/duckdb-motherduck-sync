// Vitest setup file
import 'fake-indexeddb/auto';

// Set test environment
process.env.NODE_ENV = 'test';

// Global test utilities
global.structuredClone = global.structuredClone ?? ((obj: unknown) => JSON.parse(JSON.stringify(obj)));

// Mock Worker for motherduck-wasm-client
global.Worker = class Worker {
  constructor() {}
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
} as any;