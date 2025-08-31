import * as duckdb from '@duckdb/duckdb-wasm';
import { pipe } from 'fp-ts/function';
import {
  createSimpleSyncEngine,
  createDuckDBAdapter,
  createMotherDuckProductionClient,
  createNetworkMonitor,
  createDuckDBChangeTracker,
  createIndexedDBAdapter,
  createProductionSyncConfig,
} from '../dist/index.js';

// Global state
let db;
let syncEngine;
let networkMonitor;
let motherduckClient;
let changeTracker;
let isAutoSyncing = false;
let metrics = {
  totalSynced: 0,
  pendingChanges: 0,
  lastSyncTime: null,
  syncErrors: 0,
};

// UI Elements
const elements = {
  token: document.getElementById('token'),
  initBtn: document.getElementById('initBtn'),
  testConnectionBtn: document.getElementById('testConnectionBtn'),
  createTablesBtn: document.getElementById('createTablesBtn'),
  networkStatus: document.getElementById('networkStatus'),
  syncStatus: document.getElementById('syncStatus'),
  mdStatus: document.getElementById('mdStatus'),
  userName: document.getElementById('userName'),
  userEmail: document.getElementById('userEmail'),
  addUserBtn: document.getElementById('addUserBtn'),
  bulkAddBtn: document.getElementById('bulkAddBtn'),
  localData: document.getElementById('localData'),
  syncBtn: document.getElementById('syncBtn'),
  pushBtn: document.getElementById('pushBtn'),
  pullBtn: document.getElementById('pullBtn'),
  autoSyncBtn: document.getElementById('autoSyncBtn'),
  stopAutoSyncBtn: document.getElementById('stopAutoSyncBtn'),
  conflictStrategy: document.getElementById('conflictStrategy'),
  resolveConflictsBtn: document.getElementById('resolveConflictsBtn'),
  log: document.getElementById('log'),
  clearLogBtn: document.getElementById('clearLogBtn'),
  // Metrics
  totalSynced: document.getElementById('totalSynced'),
  pendingChanges: document.getElementById('pendingChanges'),
  lastSyncTime: document.getElementById('lastSyncTime'),
  syncErrors: document.getElementById('syncErrors'),
};

// Logging with levels
function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.textContent = `[${timestamp}] ${message}`;
  elements.log.appendChild(entry);
  elements.log.scrollTop = elements.log.scrollHeight;
  
  // Also log to console for debugging
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// Update metrics display
function updateMetrics() {
  elements.totalSynced.textContent = metrics.totalSynced;
  elements.pendingChanges.textContent = metrics.pendingChanges;
  elements.lastSyncTime.textContent = metrics.lastSyncTime 
    ? new Date(metrics.lastSyncTime).toLocaleTimeString()
    : 'Never';
  elements.syncErrors.textContent = metrics.syncErrors;
}

// Update status displays
function updateNetworkStatus(online) {
  elements.networkStatus.textContent = online ? 'Online' : 'Offline';
  elements.networkStatus.className = `status ${online ? 'online' : 'offline'}`;
}

function updateSyncStatus(state) {
  elements.syncStatus.textContent = state.type;
  elements.syncStatus.className = `status ${state.type}`;
  
  if (state.type === 'syncing' && state.progress !== undefined) {
    elements.syncStatus.textContent = `Syncing ${state.progress}%`;
  } else if (state.type === 'error') {
    metrics.syncErrors++;
    updateMetrics();
    log(`Sync error: ${state.error.message}`, 'error');
  }
}

function updateMotherDuckStatus(connected) {
  elements.mdStatus.textContent = connected ? 'Connected' : 'Disconnected';
  elements.mdStatus.className = `status ${connected ? 'online' : 'offline'}`;
}

// Load and display local data
async function loadLocalData() {
  try {
    const conn = await db.connect();
    const result = await conn.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 10');
    
    let html = '<h3>Local Users (Latest 10)</h3>';
    const users = result.toArray();
    
    if (users.length > 0) {
      html += '<table><tr><th>ID</th><th>Name</th><th>Email</th><th>Created</th><th>Synced</th></tr>';
      for (const row of users) {
        const synced = row.sync_status === 1 ? '✅' : '⏳';
        html += `<tr>
          <td>${row.id}</td>
          <td>${row.name}</td>
          <td>${row.email}</td>
          <td>${new Date(row.created_at).toLocaleString()}</td>
          <td>${synced}</td>
        </tr>`;
      }
      html += '</table>';
      
      // Get total count
      const countResult = await conn.query('SELECT COUNT(*) as total FROM users');
      const total = countResult.toArray()[0].total;
      html += `<p>Total users in local database: ${total}</p>`;
    } else {
      html += '<p>No users found</p>';
    }
    
    // Update pending changes count
    const pendingResult = await conn.query(
      'SELECT COUNT(*) as count FROM _sync_changes WHERE synced = 0'
    );
    metrics.pendingChanges = pendingResult.toArray()[0].count;
    updateMetrics();
    
    await conn.close();
    elements.localData.innerHTML = html;
  } catch (error) {
    log(`Failed to load data: ${error.message}`, 'error');
    elements.localData.innerHTML = '<p>Error loading data</p>';
  }
}

// Initialize the application
async function initialize() {
  const token = elements.token.value.trim();
  if (!token) {
    alert('Please enter your MotherDuck token');
    return;
  }

  try {
    log('Initializing production sync environment...');
    
    // Initialize DuckDB WASM
    log('Loading DuckDB WASM...');
    const DUCKDB_CONFIG = await duckdb.selectBundle({
      mvp: {
        mainModule: '/node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm',
        mainWorker: '/node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js',
      },
    });

    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const worker = new Worker(DUCKDB_CONFIG.mainWorker);
    db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(DUCKDB_CONFIG.mainModule);
    
    // Create local tables
    log('Creating local database schema...');
    const conn = await db.connect();
    
    // Users table with sync metadata
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name VARCHAR NOT NULL,
        email VARCHAR NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sync_status INTEGER DEFAULT 0,
        sync_version INTEGER DEFAULT 1,
        motherduck_id VARCHAR
      )
    `);
    
    // Change tracking table
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
    
    await conn.close();
    
    // Setup sync components
    log('Setting up sync components...');
    
    // Storage
    const storageResult = await pipe(
      createIndexedDBAdapter({ 
        dbName: 'motherduck-sync-prod', 
        storeName: 'sync-data' 
      })
    )();
    
    if (storageResult._tag === 'Left') {
      throw new Error('Failed to create storage adapter');
    }
    
    // DuckDB adapter
    const duckdbAdapterResult = await pipe(createDuckDBAdapter(db))();
    if (duckdbAdapterResult._tag === 'Left') {
      throw new Error('Failed to create DuckDB adapter');
    }
    
    // MotherDuck client
    log('Connecting to MotherDuck...');
    motherduckClient = createMotherDuckProductionClient();
    
    const authResult = await pipe(
      motherduckClient.authenticate(token)
    )();
    
    if (authResult._tag === 'Left') {
      throw new Error(`MotherDuck authentication failed: ${authResult.left.message}`);
    }
    
    updateMotherDuckStatus(true);
    log('MotherDuck connection established', 'success');
    
    // Network monitor
    networkMonitor = createNetworkMonitor();
    
    // Change tracker
    changeTracker = createDuckDBChangeTracker(
      storageResult.right,
      duckdbAdapterResult.right
    );
    
    // Sync engine
    syncEngine = createSimpleSyncEngine({
      networkMonitor,
      changeTracker,
      localDb: duckdbAdapterResult.right,
      motherduckClient,
    });
    
    // Initialize sync
    const syncConfig = {
      motherduckToken: token,
      tables: ['users'],
      syncInterval: 60000, // 1 minute
      conflictStrategy: elements.conflictStrategy.value,
      enableCompression: true,
      batchSize: 1000,
    };
    
    const result = await pipe(
      syncEngine.initialize(syncConfig)
    )();
    
    if (result._tag === 'Left') {
      throw new Error(`Sync initialization failed: ${result.left.message}`);
    }
    
    // Subscribe to state changes
    networkMonitor.state$.subscribe(state => {
      updateNetworkStatus(state.online);
    });
    
    syncEngine.syncState$.subscribe(state => {
      updateSyncStatus(state);
    });
    
    // Enable UI
    elements.testConnectionBtn.disabled = false;
    elements.createTablesBtn.disabled = false;
    elements.addUserBtn.disabled = false;
    elements.bulkAddBtn.disabled = false;
    elements.syncBtn.disabled = false;
    elements.pushBtn.disabled = false;
    elements.pullBtn.disabled = false;
    elements.autoSyncBtn.disabled = false;
    elements.conflictStrategy.disabled = false;
    
    log('Production sync initialized successfully!', 'success');
    await loadLocalData();
    
  } catch (error) {
    log(`Initialization failed: ${error.message}`, 'error');
    console.error('Full error:', error);
    updateMotherDuckStatus(false);
  }
}

// Test MotherDuck connection
async function testConnection() {
  try {
    log('Testing MotherDuck connection...');
    
    const result = await pipe(
      motherduckClient.executeSql('SELECT current_database() as db, now() as time')
    )();
    
    if (result._tag === 'Right' && result.right.rows.length > 0) {
      const info = result.right.rows[0];
      log(`Connected to database: ${info.db} at ${info.time}`, 'success');
    } else {
      log('Connection test failed', 'error');
    }
  } catch (error) {
    log(`Connection test error: ${error.message}`, 'error');
  }
}

// Create tables in MotherDuck
async function createTables() {
  try {
    log('Creating tables in MotherDuck...');
    
    const result = await pipe(
      motherduckClient.executeSql(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY,
          name VARCHAR NOT NULL,
          email VARCHAR NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          local_id VARCHAR,
          source_device VARCHAR
        )
      `)
    )();
    
    if (result._tag === 'Right') {
      log('Tables created successfully in MotherDuck', 'success');
    } else {
      log(`Failed to create tables: ${result.left.message}`, 'error');
    }
  } catch (error) {
    log(`Table creation error: ${error.message}`, 'error');
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
    const id = Date.now() % 1000000;
    const newUser = {
      id,
      name,
      email,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    
    const conn = await db.connect();
    await conn.query(`
      INSERT INTO users (id, name, email, created_at, updated_at)
      VALUES (${id}, '${name}', '${email}', '${newUser.created_at}', '${newUser.updated_at}')
    `);
    await conn.close();
    
    // Track the change
    const changeResult = await changeTracker.recordChange({
      table: 'users',
      operation: 'INSERT',
      data: newUser,
    });
    
    if (changeResult._tag === 'Right') {
      log(`Added user: ${name}`, 'success');
      metrics.pendingChanges++;
      updateMetrics();
    }
    
    elements.userName.value = '';
    elements.userEmail.value = '';
    await loadLocalData();
    
  } catch (error) {
    log(`Failed to add user: ${error.message}`, 'error');
  }
}

// Add bulk users for testing
async function addBulkUsers() {
  try {
    log('Adding 100 test users...');
    
    const conn = await db.connect();
    const changes = [];
    
    for (let i = 0; i < 100; i++) {
      const id = Date.now() + i;
      const user = {
        id,
        name: `Test User ${id}`,
        email: `user${id}@example.com`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      
      await conn.query(`
        INSERT INTO users (id, name, email, created_at, updated_at)
        VALUES (${user.id}, '${user.name}', '${user.email}', '${user.created_at}', '${user.updated_at}')
      `);
      
      changes.push({
        table: 'users',
        operation: 'INSERT',
        data: user,
      });
    }
    
    await conn.close();
    
    // Track all changes
    for (const change of changes) {
      await changeTracker.recordChange(change);
    }
    
    log('Added 100 test users', 'success');
    metrics.pendingChanges += 100;
    updateMetrics();
    await loadLocalData();
    
  } catch (error) {
    log(`Bulk add failed: ${error.message}`, 'error');
  }
}

// Sync operations
async function performSync() {
  try {
    log('Starting full sync...');
    const startTime = Date.now();
    
    const result = await pipe(syncEngine.sync())();
    
    if (result._tag === 'Right') {
      const duration = Date.now() - startTime;
      log(`Sync completed in ${duration}ms: ${result.right.pushed} pushed, ${result.right.pulled} pulled`, 'success');
      
      metrics.totalSynced += result.right.pushed;
      metrics.lastSyncTime = Date.now();
      updateMetrics();
      
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
    log('Pushing changes to MotherDuck...');
    const result = await pipe(syncEngine.push())();
    
    if (result._tag === 'Right') {
      log(`Push completed: ${result.right.uploaded} changes uploaded`, 'success');
      metrics.totalSynced += result.right.uploaded;
      metrics.lastSyncTime = Date.now();
      updateMetrics();
      await loadLocalData();
    } else {
      log(`Push failed: ${result.left.message}`, 'error');
    }
  } catch (error) {
    log(`Push error: ${error.message}`, 'error');
  }
}

async function performPull() {
  try {
    log('Pulling changes from MotherDuck...');
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
    log('Auto sync started (every 60 seconds)', 'success');
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

// Event listeners
elements.initBtn.addEventListener('click', initialize);
elements.testConnectionBtn.addEventListener('click', testConnection);
elements.createTablesBtn.addEventListener('click', createTables);
elements.addUserBtn.addEventListener('click', addUser);
elements.bulkAddBtn.addEventListener('click', addBulkUsers);
elements.syncBtn.addEventListener('click', performSync);
elements.pushBtn.addEventListener('click', performPush);
elements.pullBtn.addEventListener('click', performPull);
elements.autoSyncBtn.addEventListener('click', startAutoSync);
elements.stopAutoSyncBtn.addEventListener('click', stopAutoSync);
elements.clearLogBtn.addEventListener('click', () => {
  elements.log.innerHTML = '';
});

// Initial setup
log('Production test app ready. Enter your MotherDuck token to begin.');
updateMetrics();