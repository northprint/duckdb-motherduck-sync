// Vitest setup file
import 'fake-indexeddb/auto';

// Global test utilities
global.structuredClone = global.structuredClone ?? ((obj: unknown) => JSON.parse(JSON.stringify(obj)));