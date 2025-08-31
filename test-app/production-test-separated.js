import * as duckdb from '@duckdb/duckdb-wasm';

// Global state
let db;
let localChanges = [];
let lastSyncTimestamp = 0;

// UI Elements
const elements = {
  token: document.getElementById('token'),
  syncMethod: document.getElementById('syncMethod'),
  initBtn: document.getElementById('initBtn'),
  testMDBtn: document.getElementById('testMDBtn'),
  localStatus: document.getElementById('localStatus'),
  mdStatus: document.getElementById('mdStatus'),
  userName: document.getElementById('userName'),
  userEmail: document.getElementById('userEmail'),
  addUserBtn: document.getElementById('addUserBtn'),
  bulkAddBtn: document.getElementById('bulkAddBtn'),
  exportBtn: document.getElementById('exportBtn'),
  clearLocalBtn: document.getElementById('clearLocalBtn'),
  localData: document.getElementById('localData'),
  exportOutput: document.getElementById('exportOutput'),
  exportSql: document.getElementById('exportSql'),
  copyExportBtn: document.getElementById('copyExportBtn'),
  generateSyncBtn: document.getElementById('generateSyncBtn'),
  executeSyncBtn: document.getElementById('executeSyncBtn'),
  pullDataBtn: document.getElementById('pullDataBtn'),
  syncOutput: document.getElementById('syncOutput'),
  syncSql: document.getElementById('syncSql'),
  copySyncBtn: document.getElementById('copySyncBtn'),
  executeSqlBtn: document.getElementById('executeSqlBtn'),
  log: document.getElementById('log'),
  clearLogBtn: document.getElementById('clearLogBtn'),
};

// Logging
function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.textContent = `[${timestamp}] ${message}`;
  elements.log.appendChild(entry);
  elements.log.scrollTop = elements.log.scrollHeight;
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// Update status
function updateLocalStatus(status) {
  elements.localStatus.textContent = status;
  elements.localStatus.className = `status ${status.toLowerCase().replace(' ', '-')}`;
}

function updateMDStatus(status) {
  elements.mdStatus.textContent = status;
  elements.mdStatus.className = `status ${status.toLowerCase().replace(' ', '-')}`;
}

// Initialize local DuckDB
async function initializeLocal() {
  try {
    log('Initializing local DuckDB WASM...');
    updateLocalStatus('Initializing');
    
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
    
    // Create tables
    const conn = await db.connect();
    
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name VARCHAR NOT NULL,
        email VARCHAR NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sync_id VARCHAR DEFAULT (uuid()::VARCHAR),
        sync_version INTEGER DEFAULT 1,
        is_deleted BOOLEAN DEFAULT false
      )
    `);
    
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name VARCHAR NOT NULL,
        operation VARCHAR NOT NULL,
        record_id INTEGER,
        sync_id VARCHAR,
        data JSON,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await conn.close();
    
    // Enable UI
    elements.testMDBtn.disabled = false;
    elements.addUserBtn.disabled = false;
    elements.bulkAddBtn.disabled = false;
    elements.exportBtn.disabled = false;
    elements.clearLocalBtn.disabled = false;
    elements.generateSyncBtn.disabled = false;
    
    updateLocalStatus('Ready');
    log('Local database initialized successfully', 'success');
    await loadLocalData();
    
  } catch (error) {
    log(`Local initialization failed: ${error.message}`, 'error');
    updateLocalStatus('Error');
  }
}

// Load local data
async function loadLocalData() {
  try {
    const conn = await db.connect();
    
    // Get users
    const result = await conn.query(`
      SELECT * FROM users 
      WHERE is_deleted = false 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    let html = '<h3>Local Users (Latest 10)</h3>';
    const users = result.toArray();
    
    if (users.length > 0) {
      html += '<table><tr><th>ID</th><th>Name</th><th>Email</th><th>Created</th><th>Sync ID</th></tr>';
      for (const row of users) {
        html += `<tr>
          <td>${row.id}</td>
          <td>${row.name}</td>
          <td>${row.email}</td>
          <td>${new Date(row.created_at).toLocaleString()}</td>
          <td>${row.sync_id.substring(0, 8)}...</td>
        </tr>`;
      }
      html += '</table>';
    } else {
      html += '<p>No users found</p>';
    }
    
    // Get counts
    const countResult = await conn.query('SELECT COUNT(*) as total FROM users WHERE is_deleted = false');
    const total = countResult.toArray()[0].total;
    
    const changesResult = await conn.query('SELECT COUNT(*) as changes FROM _sync_log WHERE timestamp > ?', [lastSyncTimestamp]);
    const changes = changesResult.toArray()[0].changes;
    
    html += `<p>Total users: ${total} | Unsynced changes: ${changes}</p>`;
    
    await conn.close();
    elements.localData.innerHTML = html;
    
  } catch (error) {
    log(`Failed to load data: ${error.message}`, 'error');
  }
}

// Track changes
async function trackChange(table, operation, recordId, data) {
  try {
    const conn = await db.connect();
    
    await conn.query(`
      INSERT INTO _sync_log (table_name, operation, record_id, sync_id, data)
      VALUES (?, ?, ?, ?, ?)
    `, [table, operation, recordId, data.sync_id || null, JSON.stringify(data)]);
    
    await conn.close();
    localChanges.push({ table, operation, recordId, data });
    
  } catch (error) {
    log(`Failed to track change: ${error.message}`, 'error');
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
    const conn = await db.connect();
    
    const id = Date.now() % 1000000;
    const user = {
      id,
      name,
      email,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    
    await conn.query(`
      INSERT INTO users (id, name, email, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `, [user.id, user.name, user.email, user.created_at, user.updated_at]);
    
    // Get the sync_id that was auto-generated
    const result = await conn.query('SELECT sync_id FROM users WHERE id = ?', [id]);
    user.sync_id = result.toArray()[0].sync_id;
    
    await conn.close();
    
    // Track the change
    await trackChange('users', 'INSERT', id, user);
    
    log(`Added user: ${name}`, 'success');
    elements.userName.value = '';
    elements.userEmail.value = '';
    await loadLocalData();
    
  } catch (error) {
    log(`Failed to add user: ${error.message}`, 'error');
  }
}

// Add bulk users
async function addBulkUsers() {
  try {
    log('Adding 100 test users...');
    updateLocalStatus('Processing');
    
    const conn = await db.connect();
    
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
        VALUES (?, ?, ?, ?, ?)
      `, [user.id, user.name, user.email, user.created_at, user.updated_at]);
      
      // Get sync_id
      const result = await conn.query('SELECT sync_id FROM users WHERE id = ?', [id]);
      user.sync_id = result.toArray()[0].sync_id;
      
      await trackChange('users', 'INSERT', id, user);
    }
    
    await conn.close();
    
    updateLocalStatus('Ready');
    log('Added 100 test users', 'success');
    await loadLocalData();
    
  } catch (error) {
    log(`Bulk add failed: ${error.message}`, 'error');
    updateLocalStatus('Ready');
  }
}

// Export as SQL
async function exportAsSQL() {
  try {
    const conn = await db.connect();
    
    // Get all users
    const result = await conn.query('SELECT * FROM users WHERE is_deleted = false ORDER BY id');
    const users = result.toArray();
    
    let sql = '-- DuckDB Export\n';
    sql += '-- Generated at: ' + new Date().toISOString() + '\n\n';
    
    sql += '-- Create table if not exists\n';
    sql += `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name VARCHAR NOT NULL,
  email VARCHAR NOT NULL,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  sync_id VARCHAR,
  sync_version INTEGER,
  is_deleted BOOLEAN
);\n\n`;
    
    sql += '-- Insert data\n';
    for (const user of users) {
      sql += `INSERT INTO users VALUES (${user.id}, '${user.name}', '${user.email}', `;
      sql += `'${user.created_at}', '${user.updated_at}', '${user.sync_id}', ${user.sync_version}, ${user.is_deleted});\n`;
    }
    
    await conn.close();
    
    elements.exportSql.value = sql;
    elements.exportOutput.style.display = 'block';
    log('Export completed', 'success');
    
  } catch (error) {
    log(`Export failed: ${error.message}`, 'error');
  }
}

// Generate sync SQL
async function generateSyncSQL() {
  try {
    const conn = await db.connect();
    
    // Get unsynced changes
    const result = await conn.query(`
      SELECT * FROM _sync_log 
      WHERE timestamp > ? 
      ORDER BY timestamp
    `, [lastSyncTimestamp]);
    
    const changes = result.toArray();
    
    if (changes.length === 0) {
      log('No changes to sync', 'info');
      return;
    }
    
    let sql = '-- MotherDuck Sync SQL\n';
    sql += '-- Generated at: ' + new Date().toISOString() + '\n';
    sql += `-- Changes since: ${new Date(lastSyncTimestamp).toISOString()}\n\n`;
    
    // Create table if needed
    sql += `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name VARCHAR NOT NULL,
  email VARCHAR NOT NULL,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  sync_id VARCHAR,
  sync_version INTEGER,
  is_deleted BOOLEAN,
  local_device VARCHAR
);\n\n`;
    
    // Generate SQL for each change
    sql += '-- Apply changes\n';
    for (const change of changes) {
      const data = JSON.parse(change.data);
      
      if (change.operation === 'INSERT') {
        sql += `-- Insert record ${change.record_id}\n`;
        sql += `INSERT INTO users VALUES (${data.id}, '${data.name}', '${data.email}', `;
        sql += `'${data.created_at}', '${data.updated_at}', '${data.sync_id}', 1, false, 'browser');\n\n`;
      } else if (change.operation === 'UPDATE') {
        sql += `-- Update record ${change.record_id}\n`;
        sql += `UPDATE users SET name = '${data.name}', email = '${data.email}', `;
        sql += `updated_at = '${data.updated_at}', sync_version = sync_version + 1 `;
        sql += `WHERE sync_id = '${data.sync_id}';\n\n`;
      } else if (change.operation === 'DELETE') {
        sql += `-- Delete record ${change.record_id}\n`;
        sql += `UPDATE users SET is_deleted = true, updated_at = '${data.updated_at}' `;
        sql += `WHERE sync_id = '${data.sync_id}';\n\n`;
      }
    }
    
    await conn.close();
    
    elements.syncSql.value = sql;
    elements.syncOutput.style.display = 'block';
    elements.executeSyncBtn.disabled = false;
    log(`Generated sync SQL for ${changes.length} changes`, 'success');
    
  } catch (error) {
    log(`Sync SQL generation failed: ${error.message}`, 'error');
  }
}

// Test MotherDuck connection
async function testMotherDuck() {
  const token = elements.token.value.trim();
  if (!token) {
    alert('Please enter your MotherDuck token');
    return;
  }
  
  try {
    log('Testing MotherDuck connection...');
    updateMDStatus('Connecting');
    
    // For now, just validate token format
    // In a real implementation, you would use a server proxy
    if (token.startsWith('eyJ')) {
      updateMDStatus('Ready');
      log('MotherDuck token validated (format check only)', 'success');
      log('Note: Actual connection requires server proxy or MotherDuck WASM in separate context', 'info');
      elements.executeSyncBtn.disabled = false;
      elements.pullDataBtn.disabled = false;
    } else {
      throw new Error('Invalid token format');
    }
    
  } catch (error) {
    log(`MotherDuck test failed: ${error.message}`, 'error');
    updateMDStatus('Error');
  }
}

// Execute SQL on MotherDuck
async function executeOnMotherDuck() {
  const sql = elements.syncSql.value.trim();
  if (!sql) {
    alert('No SQL to execute');
    return;
  }
  
  try {
    log('Executing SQL on MotherDuck...');
    updateMDStatus('Processing');
    
    // In a real implementation, this would:
    // 1. Send SQL to server proxy
    // 2. Server executes on MotherDuck
    // 3. Return results
    
    log('SQL execution simulated (requires server proxy)', 'info');
    log('Copy the SQL and execute manually in MotherDuck UI', 'info');
    
    // Update last sync timestamp
    lastSyncTimestamp = Date.now();
    
    // Clear local sync log
    const conn = await db.connect();
    await conn.query('DELETE FROM _sync_log WHERE timestamp <= ?', [lastSyncTimestamp]);
    await conn.close();
    
    updateMDStatus('Ready');
    log('Sync marked as complete', 'success');
    await loadLocalData();
    
  } catch (error) {
    log(`Execution failed: ${error.message}`, 'error');
    updateMDStatus('Error');
  }
}

// Copy to clipboard
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    log('Copied to clipboard', 'success');
  } catch (error) {
    log('Failed to copy to clipboard', 'error');
  }
}

// Clear local data
async function clearLocalData() {
  if (!confirm('Are you sure you want to clear all local data?')) {
    return;
  }
  
  try {
    const conn = await db.connect();
    await conn.query('DELETE FROM users');
    await conn.query('DELETE FROM _sync_log');
    await conn.close();
    
    localChanges = [];
    lastSyncTimestamp = 0;
    
    log('Local data cleared', 'success');
    await loadLocalData();
    
  } catch (error) {
    log(`Failed to clear data: ${error.message}`, 'error');
  }
}

// Event listeners
elements.initBtn.addEventListener('click', initializeLocal);
elements.testMDBtn.addEventListener('click', testMotherDuck);
elements.addUserBtn.addEventListener('click', addUser);
elements.bulkAddBtn.addEventListener('click', addBulkUsers);
elements.exportBtn.addEventListener('click', exportAsSQL);
elements.clearLocalBtn.addEventListener('click', clearLocalData);
elements.generateSyncBtn.addEventListener('click', generateSyncSQL);
elements.executeSyncBtn.addEventListener('click', executeOnMotherDuck);
elements.copyExportBtn.addEventListener('click', () => copyToClipboard(elements.exportSql.value));
elements.copySyncBtn.addEventListener('click', () => copyToClipboard(elements.syncSql.value));
elements.executeSqlBtn.addEventListener('click', executeOnMotherDuck);
elements.clearLogBtn.addEventListener('click', () => {
  elements.log.innerHTML = '';
});

// Initial message
log('Ready. Click "Initialize Local Database" to begin.');
log('This version avoids WASM conflicts by separating DuckDB and MotherDuck operations.');