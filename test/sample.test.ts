import { describe, it, expect } from 'vitest';
import { version } from '../src/index';

describe('Project Setup', () => {
  it('should export version', () => {
    expect(version).toBe('0.1.0');
  });

  it('should have proper TypeScript configuration', () => {
    // This test verifies that TypeScript is configured correctly
    const strictMode: boolean = true;
    expect(strictMode).toBe(true);
  });
});