/**
 * Tests for network monitor
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import { createMockNetworkMonitor, createNetworkMonitor } from './network-monitor';
import type { NetworkState } from '../types';

describe('Network Monitor', () => {
  describe('Mock Monitor', () => {
    it('should return initial state', () => {
      const monitor = createMockNetworkMonitor();
      const state = monitor.getCurrentState();

      expect(state.online).toBe(true);
      expect(state.type).toBe('wifi');
      expect(state.effectiveType).toBe('4g');
    });

    it('should emit state changes', async () => {
      const monitor = createMockNetworkMonitor();
      
      // Collect first 3 states
      const statesPromise = firstValueFrom(
        monitor.state$.pipe(
          take(3),
          toArray(),
        ),
      );

      // Change state twice
      monitor.setState({ online: false, type: 'unknown' });
      monitor.setState({ online: true, type: 'cellular', effectiveType: '3g' });

      const states = await statesPromise;

      expect(states).toHaveLength(3);
      expect(states[0]).toMatchObject({ online: true, type: 'wifi' });
      expect(states[1]).toMatchObject({ online: false, type: 'unknown' });
      expect(states[2]).toMatchObject({ online: true, type: 'cellular' });
    });

    it('should update current state', () => {
      const monitor = createMockNetworkMonitor();
      
      const newState: NetworkState = {
        online: false,
        type: 'ethernet',
      };

      monitor.setState(newState);
      const currentState = monitor.getCurrentState();

      expect(currentState).toEqual(newState);
    });

    it('should test connectivity based on online state', async () => {
      const monitor = createMockNetworkMonitor();
      
      // Test when online
      let result = await monitor.testConnectivity('https://example.com')();
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toBe(true);
      }

      // Test when offline
      monitor.setState({ online: false, type: 'unknown' });
      result = await monitor.testConnectivity('https://example.com')();
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toBe(false);
      }
    });

    it('should handle different network types', async () => {
      const networkTypes: Array<NetworkState['type']> = [
        'wifi',
        'cellular',
        'ethernet',
        'unknown',
      ];

      for (const type of networkTypes) {
        const monitor = createMockNetworkMonitor({
          online: true,
          type,
          effectiveType: type === 'cellular' ? '3g' : undefined,
        });

        const state = monitor.getCurrentState();
        expect(state.type).toBe(type);
      }
    });

    it('should emit initial state immediately', async () => {
      const customInitialState: NetworkState = {
        online: false,
        type: 'cellular',
        effectiveType: '2g',
      };

      const monitor = createMockNetworkMonitor(customInitialState);
      
      const firstState = await firstValueFrom(monitor.state$);
      
      expect(firstState).toEqual(customInitialState);
    });
  });

  describe('State Observable', () => {
    it('should be multicast', async () => {
      const monitor = createMockNetworkMonitor();
      
      // Subscribe multiple times
      const states1Promise = firstValueFrom(
        monitor.state$.pipe(take(2), toArray()),
      );
      
      const states2Promise = firstValueFrom(
        monitor.state$.pipe(take(2), toArray()),
      );

      // Emit one change
      monitor.setState({ online: false, type: 'unknown' });

      const [states1, states2] = await Promise.all([states1Promise, states2Promise]);

      // Both subscribers should receive the same states
      expect(states1).toEqual(states2);
      expect(states1).toHaveLength(2);
    });
  });

  describe('Real Network Monitor', () => {
    let mockNavigator: any;
    let mockWindow: any;
    let mockConnection: any;
    let eventListeners: Record<string, Array<(event: any) => void>>;

    beforeEach(() => {
      // Mock navigator
      mockNavigator = {
        onLine: true,
      };
      Object.defineProperty(globalThis, 'navigator', {
        value: mockNavigator,
        writable: true,
        configurable: true,
      });

      // Mock window events using fromEvent
      eventListeners = {
        online: [],
        offline: [],
        change: [],
      };
      
      // Create a mock event target for window
      const mockEventTarget = {
        addEventListener: vi.fn((event: string, handler: (event: any) => void) => {
          if (!eventListeners[event]) eventListeners[event] = [];
          eventListeners[event].push(handler);
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
      
      // Mock window with event target functionality
      mockWindow = mockEventTarget;
      Object.defineProperty(globalThis, 'window', {
        value: mockWindow,
        writable: true,
        configurable: true,
      });

      // Mock network connection
      mockConnection = {
        type: 'wifi',
        effectiveType: '4g',
        addEventListener: vi.fn((event, handler) => {
          if (!eventListeners[event]) eventListeners[event] = [];
          eventListeners[event].push(handler);
        }),
        removeEventListener: vi.fn(),
      };

      // Mock fetch
      globalThis.fetch = vi.fn().mockResolvedValue({} as any);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should get current network state', () => {
      const monitor = createNetworkMonitor();
      const state = monitor.getCurrentState();

      expect(state.online).toBe(true);
      expect(state.type).toBe('unknown'); // No connection API available
    });

    it('should detect network type from connection API', () => {
      // Add connection to navigator
      mockNavigator.connection = mockConnection;

      const monitor = createNetworkMonitor();
      const state = monitor.getCurrentState();

      expect(state.online).toBe(true);
      expect(state.type).toBe('wifi');
      expect(state.effectiveType).toBe('4g');
    });

    it('should handle different connection types', () => {
      const connectionTypes = [
        { type: 'cellular', expected: 'cellular' },
        { type: 'ethernet', expected: 'ethernet' },
        { type: 'bluetooth', expected: 'unknown' },
        { type: 'other', expected: 'unknown' },
        { type: 'none', expected: 'unknown' },
      ];

      connectionTypes.forEach(({ type, expected }) => {
        mockNavigator.connection = { ...mockConnection, type };
        const monitor = createNetworkMonitor();
        const state = monitor.getCurrentState();
        expect(state.type).toBe(expected);
      });
    });

    it('should handle vendor-prefixed connection APIs', () => {
      // Test mozConnection
      mockNavigator.mozConnection = mockConnection;
      let monitor = createNetworkMonitor();
      let state = monitor.getCurrentState();
      expect(state.type).toBe('wifi');

      // Test webkitConnection
      delete mockNavigator.mozConnection;
      mockNavigator.webkitConnection = mockConnection;
      monitor = createNetworkMonitor();
      state = monitor.getCurrentState();
      expect(state.type).toBe('wifi');
    });

    it('should register online/offline event listeners', () => {
      const monitor = createNetworkMonitor();
      
      // Check that event listeners were registered
      expect(mockWindow.addEventListener).toHaveBeenCalled();
      const calls = mockWindow.addEventListener.mock.calls;
      expect(calls.some((call: any[]) => call[0] === 'online')).toBe(true);
      expect(calls.some((call: any[]) => call[0] === 'offline')).toBe(true);
      
      // Verify state observable exists
      expect(monitor.state$).toBeDefined();
    });

    it('should register connection change listener when available', () => {
      mockNavigator.connection = mockConnection;
      const monitor = createNetworkMonitor();
      
      // Check that connection event listener was registered
      expect(mockConnection.addEventListener).toHaveBeenCalled();
      const calls = mockConnection.addEventListener.mock.calls;
      expect(calls.some((call: any[]) => call[0] === 'change')).toBe(true);
      
      // Verify initial state has connection info
      const state = monitor.getCurrentState();
      expect(state.type).toBe('wifi');
      expect(state.effectiveType).toBe('4g');
    });

    it('should handle no connection API gracefully', () => {
      // No connection API available
      const monitor = createNetworkMonitor();
      
      const state = monitor.getCurrentState();
      expect(state.type).toBe('unknown');
      expect(state.effectiveType).toBeUndefined();
    });

    it('should test connectivity successfully', async () => {
      const monitor = createNetworkMonitor();
      
      const result = await monitor.testConnectivity('https://example.com')();
      
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toBe(true);
      }
      
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://example.com',
        {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-cache',
        }
      );
    });

    it('should handle connectivity test failure', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));
      
      const monitor = createNetworkMonitor();
      const result = await monitor.testConnectivity('https://example.com')();
      
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toBe(false);
      }
    });

    it('should handle connectivity test exception', async () => {
      // The current implementation catches all errors in the try/catch
      // and returns false, not an error
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('Sync error');
      });
      
      const monitor = createNetworkMonitor();
      const result = await monitor.testConnectivity('https://example.com')();
      
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right).toBe(false);
      }
    });

    it('should deduplicate state changes', async () => {
      const monitor = createNetworkMonitor();
      
      const states: NetworkState[] = [];
      const subscription = monitor.state$.subscribe(state => states.push(state));

      // Wait for initial state
      await new Promise(resolve => setTimeout(resolve, 10));
      const initialCount = states.length;
      
      // Trigger multiple identical offline events
      mockNavigator.onLine = false;
      eventListeners.offline.forEach(handler => {
        handler({ type: 'offline' } as any);
        handler({ type: 'offline' } as any); // Duplicate
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Should only add one offline state, not two
      const offlineCount = states.length - initialCount;
      expect(offlineCount).toBe(1);
      
      subscription.unsubscribe();
    });

    it('should share state observable among subscribers', () => {
      const monitor = createNetworkMonitor();
      
      let count1 = 0;
      let count2 = 0;
      
      // Subscribe twice
      monitor.state$.subscribe(() => count1++);
      monitor.state$.subscribe(() => count2++);
      
      // Trigger state change
      mockNavigator.onLine = false;
      eventListeners.offline.forEach(handler => handler({ type: 'offline' } as any));
      
      // Both should receive the same events
      expect(count1).toBe(count2);
      expect(count1).toBeGreaterThan(0);
    });

    it('should handle offline state correctly', () => {
      mockNavigator.onLine = false;
      
      const monitor = createNetworkMonitor();
      const state = monitor.getCurrentState();
      
      expect(state.online).toBe(false);
    });
  });
});