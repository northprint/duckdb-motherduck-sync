/**
 * Web Worker for MotherDuck synchronization (ES Module version)
 * Runs in separate context to avoid WASM conflicts
 */

// Use dynamic import to avoid top-level await issues
let MDConnection;

let mdConnection = null;
let isInitialized = false;

// Message handler
self.addEventListener('message', async (event) => {
  const { type, id } = event.data;
  
  try {
    switch (type) {
      case 'INITIALIZE':
        await initialize(event.data.token);
        self.postMessage({ type: 'INITIALIZED', id });
        break;
        
      case 'SYNC':
        const result = await sync(event.data);
        self.postMessage({ type: 'SUCCESS', id, result });
        break;
        
      default:
        self.postMessage({ type: 'ERROR', id, error: 'Unknown message type' });
    }
  } catch (error) {
    self.postMessage({ type: 'ERROR', id, error: error.message });
  }
});

async function initialize(token) {
  if (!token) {
    throw new Error('MotherDuck token is required');
  }
  
  // Import MotherDuck client
  try {
    const module = await import('/node_modules/@motherduck/wasm-client/index.js');
    MDConnection = module.MDConnection;
  } catch (error) {
    throw new Error(`Failed to import MotherDuck client: ${error.message}`);
  }
  
  // Create connection
  mdConnection = MDConnection.create({ mdToken: token });
  
  // Wait for initialization
  let attempts = 0;
  while (attempts < 30) {
    if (await mdConnection.isInitialized()) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }
  
  if (!await mdConnection.isInitialized()) {
    throw new Error('Failed to initialize MotherDuck connection');
  }
  
  isInitialized = true;
}

async function sync(data) {
  if (!isInitialized || !mdConnection) {
    throw new Error('MotherDuck connection not initialized');
  }
  
  const { changes, schemas } = data;
  const results = { pushed: 0, pulled: [], errors: [] };
  
  try {
    // Create tables if not exists
    for (const [tableName, schema] of Object.entries(schemas)) {
      const columns = schema.map(col => 
        `${col.column_name} ${col.data_type}`
      ).join(', ');
      
      await mdConnection.evaluateQuery(`
        CREATE TABLE IF NOT EXISTS ${tableName} (${columns})
      `);
    }
    
    // Push changes
    for (const change of changes) {
      try {
        const { table_name, operation, data } = change;
        
        if (operation === 'INSERT') {
          const columns = Object.keys(data).join(', ');
          const values = Object.values(data).map(v => 
            typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v
          ).join(', ');
          
          await mdConnection.evaluateQuery(`
            INSERT INTO ${table_name} (${columns}) VALUES (${values})
          `);
          results.pushed++;
        }
        // Handle UPDATE and DELETE as needed
      } catch (error) {
        results.errors.push({ change, error: error.message });
      }
    }
    
    // TODO: Pull changes from MotherDuck
    // This would require tracking last sync time and querying for changes
    
    return results;
    
  } catch (error) {
    throw new Error(`Sync failed: ${error.message}`);
  }
}