/**
 * Network connection monitoring
 */

import { Subject, Observable, fromEvent, merge, of } from 'rxjs';
import { map, distinctUntilChanged, startWith, share } from 'rxjs/operators';
import * as TE from 'fp-ts/TaskEither';
import type { TaskEither } from 'fp-ts/TaskEither';
import { networkError } from '../types/errors';
import type { NetworkState, SyncError } from '../types';

// Network monitor interface
export interface NetworkMonitor {
  readonly getCurrentState: () => NetworkState;
  readonly state$: Observable<NetworkState>;
  readonly testConnectivity: (url: string) => TaskEither<SyncError, boolean>;
}

// Network information API types
interface NetworkInformation extends EventTarget {
  readonly effectiveType?: '4g' | '3g' | '2g' | 'slow-2g';
  readonly type?: 'bluetooth' | 'cellular' | 'ethernet' | 'wifi' | 'wimax' | 'other' | 'unknown' | 'none';
  readonly downlink?: number;
  readonly rtt?: number;
  readonly saveData?: boolean;
  addEventListener(type: 'change', listener: EventListener): void;
  removeEventListener(type: 'change', listener: EventListener): void;
}

// Extend Navigator interface
interface NavigatorWithConnection extends Navigator {
  readonly connection?: NetworkInformation;
  readonly mozConnection?: NetworkInformation;
  readonly webkitConnection?: NetworkInformation;
}

// Get network connection info
const getConnection = (): NetworkInformation | undefined => {
  const nav = navigator as NavigatorWithConnection;
  return nav.connection || nav.mozConnection || nav.webkitConnection;
};

// Get current network state
const getCurrentNetworkState = (): NetworkState => {
  const online = navigator.onLine;
  const connection = getConnection();

  let type: NetworkState['type'] = 'unknown';
  
  if (connection?.type) {
    switch (connection.type) {
      case 'wifi':
        type = 'wifi';
        break;
      case 'cellular':
        type = 'cellular';
        break;
      case 'ethernet':
        type = 'ethernet';
        break;
      default:
        type = 'unknown';
    }
  }

  return {
    online,
    type,
    effectiveType: connection?.effectiveType,
  };
};

// Create network monitor
export const createNetworkMonitor = (): NetworkMonitor => {
  // Create state subject
  const stateSubject = new Subject<NetworkState>();
  
  // Online/offline events
  const onlineEvents$ = fromEvent(window, 'online').pipe(
    map(() => true),
  );
  
  const offlineEvents$ = fromEvent(window, 'offline').pipe(
    map(() => false),
  );
  
  const onlineStatus$ = merge(
    onlineEvents$,
    offlineEvents$,
    of(navigator.onLine),
  ).pipe(
    distinctUntilChanged(),
  );

  // Network connection change events
  const connection = getConnection();
  const connectionChange$ = connection
    ? fromEvent(connection, 'change')
    : of(null);

  // Combined network state
  const networkState$ = merge(
    onlineStatus$,
    connectionChange$,
  ).pipe(
    map(() => getCurrentNetworkState()),
    startWith(getCurrentNetworkState()),
    distinctUntilChanged((prev, curr) => 
      prev.online === curr.online &&
      prev.type === curr.type &&
      prev.effectiveType === curr.effectiveType
    ),
    share(),
  );

  // Subscribe to state changes
  networkState$.subscribe(state => stateSubject.next(state));

  return {
    getCurrentState: getCurrentNetworkState,
    
    state$: stateSubject.asObservable(),
    
    testConnectivity: (url: string) =>
      TE.tryCatch(
        async () => {
          try {
            await fetch(url, {
              method: 'HEAD',
              mode: 'no-cors',
              cache: 'no-cache',
            });
            return true;
          } catch {
            return false;
          }
        },
        (_error) => networkError('Connectivity test failed', false),
      ),
  };
};

// Create mock network monitor for testing
export const createMockNetworkMonitor = (
  initialState: NetworkState = { online: true, type: 'wifi', effectiveType: '4g' },
): NetworkMonitor & { setState: (state: NetworkState) => void } => {
  const stateSubject = new Subject<NetworkState>();
  let currentState = initialState;

  return {
    getCurrentState: () => currentState,
    
    state$: stateSubject.asObservable().pipe(
      startWith(currentState),
    ),
    
    testConnectivity: (_url: string) =>
      TE.of(currentState.online),
    
    setState: (state: NetworkState) => {
      currentState = state;
      stateSubject.next(state);
    },
  };
};