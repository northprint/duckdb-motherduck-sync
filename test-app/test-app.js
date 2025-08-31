import * as duckdb from '@duckdb/duckdb-wasm';
import { pipe } from 'fp-ts/function';
import {
  createSyncEngine,
  createSimpleSyncEngine,
  createDuckDBAdapter,
  createMotherDuckClient,
  createNetworkMonitor,
  createChangeTracker,
  createDuckDBChangeTracker,
  createIndexedDBAdapter,
  createMockMotherDuckClient,
  createMotherDuckWASMClient,
} from '../dist/index.js';
import { createSimpleChangeTracker } from './simple-tracker.js';

// Global variables
let db;
let syncEngine;
let networkMonitor;
let isAutoSyncing = false;
let changeTracker;
let duckdbAdapter;

// UI Elements
const elements = {
  token: document.getElementById('token'),
  initBtn: document.getElementById('initBtn'),
  networkStatus: document.getElementById('networkStatus'),
  syncStatus: document.getElementById('syncStatus'),
  userName: document.getElementById('userName'),
  userEmail: document.getElementById('userEmail'),
  addUserBtn: document.getElementById('addUserBtn'),
  localData: document.getElementById('localData'),
  syncBtn: document.getElementById('syncBtn'),
  pushBtn: document.getElementById('pushBtn'),
  pullBtn: document.getElementById('pullBtn'),
  autoSyncBtn: document.getElementById('autoSyncBtn'),
  stopAutoSyncBtn: document.getElementById('stopAutoSyncBtn'),
  goOfflineBtn: document.getElementById('goOfflineBtn'),
  goOnlineBtn: document.getElementById('goOnlineBtn'),
  log: document.getElementById('log'),
  clearLogBtn: document.getElementById('clearLogBtn'),
};

// Logging
function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  elements.log.appendChild(entry);
  elements.log.scrollTop = elements.log.scrollHeight;
}

// Update UI based on network status
function updateNetworkStatus(online) {
  elements.networkStatus.textContent = online ? 'Online' : 'Offline';
  elements.networkStatus.className = `status ${online ? 'online' : 'offline'}`;
}

// Update sync status
function updateSyncStatus(state) {
  elements.syncStatus.textContent = state.type;
  elements.syncStatus.className = `status ${state.type}`;
  
  if (state.type === 'syncing' && state.progress !== undefined) {
    elements.syncStatus.textContent = `Syncing ${state.progress}%`;
  } else if (state.type === 'error') {
    log(`Sync error: ${state.error.message}`, 'error');
  } else if (state.type === 'conflict') {
    log(`Conflicts detected: ${state.conflicts.length}`, 'error');
  }
}

// Load and display local data
async function loadLocalData() {
  try {
    // Short delay to ensure DB is ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const conn = await db.connect();
    
    try {
      const result = await conn.query('SELECT * FROM users ORDER BY created_at DESC');
      
      let html = '<h3>Users</h3>';
      if (result.numRows > 0) {
        html += '<table><tr><th>ID</th><th>Name</th><th>Email</th><th>Created</th></tr>';
        for (const row of result) {
          html += `<tr>
            <td>${row.id}</td>
            <td>${row.name}</td>
            <td>${row.email}</td>
            <td>${new Date(row.created_at).toLocaleString()}</td>
          </tr>`;
        }
        html += '</table>';
      } else {
        html += '<p>No users found</p>';
      }
      
      elements.localData.innerHTML = html;
    } finally {
      await conn.close();
    }
  } catch (error) {
    console.error('Error loading data:', error);
    log(`Failed to load data: ${error.message || error}`, 'error');
    // Display empty state on error
    elements.localData.innerHTML = '<h3>Users</h3><p>Unable to load users</p>';
  }
}

// Initialize database and sync engine
async function initialize() {
  const token = elements.token.value.trim();
  if (!token) {
    alert('Please enter your MotherDuck token');
    return;
  }

  try {
    log('Initializing DuckDB WASM...');
    
    // Initialize DuckDB
    const DUCKDB_CONFIG = await duckdb.selectBundle({
      mvp: {
        mainModule: '/node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm',
        mainWorker: '/node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js',
      },
    });

    const logger = new duckdb.ConsoleLogger();
    const worker = new Worker(DUCKDB_CONFIG.mainWorker);
    db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(DUCKDB_CONFIG.mainModule);

    // Create tables
    log('Creating tables...');
    const conn = await db.connect();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name VARCHAR NOT NULL,
        email VARCHAR NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create change tracking tables
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _sync_changes (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        operation TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        data TEXT NOT NULL,
        old_data TEXT,
        synced INTEGER DEFAULT 0
      )
    `);
    
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_sync_changes_timestamp 
      ON _sync_changes(timestamp)
    `);
    
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_sync_changes_synced 
      ON _sync_changes(synced)
    `);
    
    // Test the table
    const testResult = await conn.query('SELECT COUNT(*) as count FROM _sync_changes');
    log(`Change tracking table initialized with ${testResult.toArray()[0].count} records`);
    
    await conn.close();

    // Setup sync components
    log('Setting up sync engine...');
    const storageResult = await pipe(createIndexedDBAdapter({ dbName: 'sync-test-db', storeName: 'sync-data' }))();
    
    if (storageResult._tag === 'Left') {
      throw new Error('Failed to create storage adapter');
    }

    const duckdbAdapterResult = await pipe(createDuckDBAdapter(db))();
    
    if (duckdbAdapterResult._tag === 'Left') {
      throw new Error('Failed to create DuckDB adapter');
    }
    
    duckdbAdapter = duckdbAdapterResult.right;

    // Use mock client to avoid conflicts with DuckDB WASM
    // TODO: Implement proper MotherDuck REST API client
    const motherduckClient = createMockMotherDuckClient();

    networkMonitor = createNetworkMonitor();
    
    try {
      // Use simple change tracker for testing
      changeTracker = createSimpleChangeTracker(db);
      log('Change tracker created successfully');
    } catch (error) {
      console.error('Error creating change tracker:', error);
      throw new Error('Failed to create change tracker');
    }

    // Use simplified sync engine for testing
    syncEngine = createSimpleSyncEngine({
      networkMonitor,
      changeTracker,
      localDb: duckdbAdapter,
      motherduckClient,
    });

    // Initialize sync
    log('Initializing sync engine with config...');
    
    // Wrap in try-catch to handle initialization errors
    let result;
    try {
      result = await pipe(
        syncEngine.initialize({
          motherduckToken: 'valid-token', // Use mock-compatible token
          syncInterval: 30000,
          conflictStrategy: 'latest-wins',
          tables: ['users'], // Track users table
          enableCompression: true,
        })
      )();
    } catch (initError) {
      console.error('Direct initialization error:', initError);
      result = { _tag: 'Left', left: { type: 'unknown-error', message: String(initError), error: initError } };
    }

    if (result._tag === 'Left') {
      console.error('Sync engine initialization error:', result.left);
      if (result.left.error) {
        console.error('Underlying error:', result.left.error);
      }
      throw new Error(`Initialization failed: ${result.left.message} (${result.left.type})`);
    }

    // Subscribe to state changes
    networkMonitor.state$.subscribe(state => {
      updateNetworkStatus(state.online);
    });

    syncEngine.syncState$.subscribe(state => {
      updateSyncStatus(state);
    });

    // Update sync status immediately with current state
    updateSyncStatus({ type: 'idle' });

    // Enable UI
    elements.addUserBtn.disabled = false;
    elements.syncBtn.disabled = false;
    elements.pushBtn.disabled = false;
    elements.pullBtn.disabled = false;
    elements.autoSyncBtn.disabled = false;

    log('Initialization complete!', 'success');
    // Skip initial load due to DuckDB WASM issue
    elements.localData.innerHTML = '<h3>Users</h3><p>Ready to add users</p>';

  } catch (error) {
    console.error('Full initialization error:', error);
    log(`Initialization failed: ${error.message}`, 'error');
  }
}

// Add user
async function addUser() {
  const name = elements.userName.value.trim();
  const email = elements.userEmail.value.trim();

  if (!name || !email) {
    alert('Please enter both name and email');
    return;
  }

  try {
    const id = Date.now() % 1000000; // Simple ID generation
    const newUser = {
      id,
      name,
      email,
      created_at: new Date().toISOString()
    };

    // Insert using DuckDB adapter to ensure change tracking
    const conn = await db.connect();
    await conn.query(
      `INSERT INTO users (id, name, email, created_at) VALUES (${id}, '${name}', '${email}', '${newUser.created_at}')`
    );
    await conn.close();

    // Record the change for sync
    const changeResult = await changeTracker.recordChange({
      table: 'users',
      operation: 'INSERT',
      data: newUser,
    });

    if (changeResult._tag === 'Left') {
      console.error('Change tracking error:', changeResult.left);
      log(`Warning: Change tracking failed: ${changeResult.left.message}`, 'error');
    } else {
      log('Change tracked successfully', 'info');
    }

    log(`Added user: ${name}`, 'success');
    elements.userName.value = '';
    elements.userEmail.value = '';
    
    // Load data to show the new user
    await loadLocalData();
  } catch (error) {
    log(`Failed to add user: ${error.message}`, 'error');
  }
}

// Sync operations
async function performSync() {
  try {
    log('Starting manual sync...');
    const result = await pipe(syncEngine.sync())();

    if (result._tag === 'Right') {
      log(`Sync completed: ${result.right.pushed} pushed, ${result.right.pulled} pulled`, 'success');
      await loadLocalData();
    } else {
      log(`Sync failed: ${result.left.message}`, 'error');
    }
  } catch (error) {
    log(`Sync error: ${error.message}`, 'error');
  }
}

async function performPush() {
  try {
    log('Pushing local changes...');
    const result = await pipe(syncEngine.push())();

    if (result._tag === 'Right') {
      log(`Push completed: ${result.right.uploaded} changes uploaded`, 'success');
    } else {
      log(`Push failed: ${result.left.message}`, 'error');
    }
  } catch (error) {
    log(`Push error: ${error.message}`, 'error');
  }
}

async function performPull() {
  try {
    log('Pulling remote changes...');
    const result = await pipe(syncEngine.pull())();

    if (result._tag === 'Right') {
      log(`Pull completed: ${result.right.applied} changes applied`, 'success');
      await loadLocalData();
    } else {
      log(`Pull failed: ${result.left.message}`, 'error');
    }
  } catch (error) {
    log(`Pull error: ${error.message}`, 'error');
  }
}

// Auto sync
function startAutoSync() {
  if (!isAutoSyncing) {
    syncEngine.startAutoSync();
    isAutoSyncing = true;
    elements.autoSyncBtn.disabled = true;
    elements.stopAutoSyncBtn.disabled = false;
    log('Auto sync started', 'success');
  }
}

function stopAutoSync() {
  if (isAutoSyncing) {
    syncEngine.stopAutoSync();
    isAutoSyncing = false;
    elements.autoSyncBtn.disabled = false;
    elements.stopAutoSyncBtn.disabled = true;
    log('Auto sync stopped', 'success');
  }
}

// Network simulation
function goOffline() {
  if (networkMonitor) {
    networkMonitor.setState({ online: false, type: 'unknown' });
    log('Simulated offline mode', 'info');
  }
}

function goOnline() {
  if (networkMonitor) {
    networkMonitor.setState({ online: true, type: 'wifi' });
    log('Simulated online mode', 'info');
  }
}

// Event listeners
elements.initBtn.addEventListener('click', initialize);
elements.addUserBtn.addEventListener('click', addUser);
elements.syncBtn.addEventListener('click', performSync);
elements.pushBtn.addEventListener('click', performPush);
elements.pullBtn.addEventListener('click', performPull);
elements.autoSyncBtn.addEventListener('click', startAutoSync);
elements.stopAutoSyncBtn.addEventListener('click', stopAutoSync);
elements.goOfflineBtn.addEventListener('click', goOffline);
elements.goOnlineBtn.addEventListener('click', goOnline);
elements.clearLogBtn.addEventListener('click', () => {
  elements.log.innerHTML = '';
});

// Initial setup
log('Ready. Please enter your MotherDuck token and click Initialize.');