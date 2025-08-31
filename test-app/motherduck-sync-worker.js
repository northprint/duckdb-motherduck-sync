// MotherDuck Sync Worker
// This worker handles the actual sync with MotherDuck

importScripts('https://cdn.jsdelivr.net/npm/@motherduck/wasm-client@latest/dist/motherduck-wasm-client.min.js');

let mdConnection = null;

// Initialize MotherDuck connection
async function initializeMotherDuck(token) {
  try {
    mdConnection = MDConnection.create({ mdToken: token });
    
    // Wait for initialization
    let attempts = 0;
    while (attempts < 30) {
      if (await mdConnection.isInitialized()) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    if (!await mdConnection.isInitialized()) {
      throw new Error('MotherDuck connection timeout');
    }
    
    // Setup database
    await mdConnection.evaluateQuery('CREATE DATABASE IF NOT EXISTS duckdb_sync');
    await mdConnection.evaluateQuery('USE duckdb_sync');
    
    // Create table
    await mdConnection.evaluateQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR PRIMARY KEY,
        name VARCHAR NOT NULL,
        email VARCHAR NOT NULL,
        created_at TIMESTAMP,
        sync_id VARCHAR,
        source VARCHAR DEFAULT 'mobile'
      )
    `);
    
    return true;
  } catch (error) {
    console.error('MotherDuck init error:', error);
    throw error;
  }
}

// Sync users to MotherDuck
async function syncUsers(users) {
  const results = {
    synced: 0,
    failed: 0,
    errors: []
  };
  
  for (const user of users) {
    try {
      await mdConnection.evaluateQuery(`
        INSERT INTO users (id, name, email, created_at, sync_id) 
        VALUES (
          '${user.id}', 
          '${user.name.replace(/'/g, "''")}', 
          '${user.email.replace(/'/g, "''")}',
          '${user.created_at}',
          '${user.id}'
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email
      `);
      
      results.synced++;
    } catch (error) {
      results.failed++;
      results.errors.push({ user: user.id, error: error.message });
    }
  }
  
  return results;
}

// Message handler
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;
  
  try {
    switch (type) {
      case 'INIT':
        await initializeMotherDuck(data.token);
        self.postMessage({ type: 'INIT_SUCCESS' });
        break;
        
      case 'SYNC':
        const results = await syncUsers(data.users);
        self.postMessage({ type: 'SYNC_SUCCESS', results });
        break;
        
      case 'QUERY':
        const result = await mdConnection.evaluateQuery(data.sql);
        self.postMessage({ type: 'QUERY_SUCCESS', result });
        break;
        
      default:
        self.postMessage({ type: 'ERROR', error: 'Unknown message type' });
    }
  } catch (error) {
    self.postMessage({ type: 'ERROR', error: error.message });
  }
});