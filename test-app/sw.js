// Service Worker for DuckDB Offline Sync
const CACHE_NAME = 'duckdb-offline-v1';
const urlsToCache = [
  '/',
  '/offline-first-pwa.html',
  '/node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm',
  '/node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js',
];

// Install event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

// Background sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-users') {
    event.waitUntil(syncUsers());
  }
});

// Message handling for sync
self.addEventListener('message', async (event) => {
  if (event.data.type === 'SYNC_USERS') {
    try {
      const result = await syncToMotherDuck(event.data.users);
      
      // Send response back to the page
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({ type: 'SYNC_COMPLETE', result });
      });
    } catch (error) {
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({ type: 'SYNC_ERROR', error: error.message });
      });
    }
  }
});

// Sync function for MotherDuck via API server
async function syncToMotherDuck(users) {
  const API_URL = self.location.hostname === 'localhost' 
    ? 'http://localhost:3001' 
    : 'https://your-server.com';

  try {
    // Get last sync time from IndexedDB
    const db = await openDB();
    const lastSyncTime = await getLastSyncTime(db);
    
    // Push changes to server
    const response = await fetch(`${API_URL}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        users,
        lastSyncTime 
      })
    });
    
    if (!response.ok) {
      throw new Error(`Sync failed: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    // Update last sync time
    await updateLastSyncTime(db, result.timestamp);
    
    // If there are conflicts, notify the main app
    if (result.results.conflicts && result.results.conflicts.length > 0) {
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({ 
          type: 'SYNC_CONFLICTS', 
          conflicts: result.results.conflicts 
        });
      });
    }
    
    return result;
  } catch (error) {
    console.error('Sync error:', error);
    throw error;
  }
}

// IndexedDB helpers
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('DuckDBSync', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata', { keyPath: 'key' });
      }
    };
  });
}

async function getLastSyncTime(db) {
  const transaction = db.transaction(['metadata'], 'readonly');
  const store = transaction.objectStore('metadata');
  const request = store.get('lastSyncTime');
  
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => resolve(null);
  });
}

async function updateLastSyncTime(db, timestamp) {
  const transaction = db.transaction(['metadata'], 'readwrite');
  const store = transaction.objectStore('metadata');
  store.put({ key: 'lastSyncTime', value: timestamp });
}