/**
 * Tests for network monitor
 */

import { describe, it, expect } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import { createMockNetworkMonitor } from './network-monitor';
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
});