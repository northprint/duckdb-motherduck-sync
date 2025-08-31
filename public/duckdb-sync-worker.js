/**
 * Web Worker for MotherDuck synchronization
 * Runs in separate context to avoid WASM conflicts
 */

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
  
  // Import MotherDuck WASM client - using ES modules in worker
  const { MDConnection } = await import('/node_modules/@motherduck/wasm-client/index.js');
  
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
    throw new Error('MotherDuck connection timeout');
  }
  
  // Setup database
  await mdConnection.evaluateQuery('CREATE DATABASE IF NOT EXISTS duckdb_sync');
  await mdConnection.evaluateQuery('USE duckdb_sync');
  
  isInitialized = true;
}

async function sync(data) {
  if (!isInitialized) {
    throw new Error('Worker not initialized');
  }
  
  const { changes, schemas } = data;
  const results = { pushed: 0, failed: 0, pulled: [] };
  
  // Create tables if needed
  for (const [tableName, columns] of Object.entries(schemas)) {
    await ensureTable(tableName, columns);
  }
  
  // Push changes
  for (const change of changes) {
    try {
      await applyChange(change);
      results.pushed++;
    } catch (error) {
      console.error('Sync error:', error);
      results.failed++;
    }
  }
  
  // Pull changes (simplified - you may want to add timestamp tracking)
  try {
    for (const tableName of Object.keys(schemas)) {
      const result = await mdConnection.evaluateQuery(`
        SELECT * FROM ${tableName} 
        WHERE updated_at > (SELECT COALESCE(MAX(created_at), '1970-01-01') FROM _sync_changes)
      `);
      
      if (result && result.data) {
        const rows = extractQueryData(result);
        results.pulled.push(...rows.map(row => ({
          table_name: tableName,
          operation: 'INSERT',
          data: row
        })));
      }
    }
  } catch (error) {
    console.error('Pull error:', error);
  }
  
  return results;
}

async function ensureTable(tableName, columns) {
  const columnDefs = columns.map(col => 
    `${col.column_name} ${col.data_type}`
  ).join(', ');
  
  await mdConnection.evaluateQuery(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      ${columnDefs},
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function applyChange(change) {
  const { table_name, operation, data, record_id } = change;
  
  switch (operation) {
    case 'INSERT':
      await insertRecord(table_name, data);
      break;
      
    case 'UPDATE':
      await updateRecord(table_name, record_id, data);
      break;
      
    case 'DELETE':
      await deleteRecord(table_name, record_id);
      break;
  }
}

async function insertRecord(tableName, data) {
  const columns = Object.keys(data).filter(k => k !== 'synced');
  const values = columns.map(col => {
    const val = data[col];
    if (val === null) return 'NULL';
    if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
    if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
    return val;
  });
  
  await mdConnection.evaluateQuery(`
    INSERT INTO ${tableName} (${columns.join(', ')}) 
    VALUES (${values.join(', ')})
    ON CONFLICT (id) DO UPDATE SET
      ${columns.map(col => `${col} = EXCLUDED.${col}`).join(', ')},
      updated_at = NOW()
  `);
}

async function updateRecord(tableName, recordId, data) {
  const updates = Object.keys(data)
    .filter(k => k !== 'id' && k !== 'synced')
    .map(col => {
      const val = data[col];
      if (val === null) return `${col} = NULL`;
      if (typeof val === 'string') return `${col} = '${val.replace(/'/g, "''")}'`;
      if (typeof val === 'object') return `${col} = '${JSON.stringify(val).replace(/'/g, "''")}'`;
      return `${col} = ${val}`;
    });
  
  await mdConnection.evaluateQuery(`
    UPDATE ${tableName} 
    SET ${updates.join(', ')}, updated_at = NOW()
    WHERE id = '${recordId}'
  `);
}

async function deleteRecord(tableName, recordId) {
  await mdConnection.evaluateQuery(`
    DELETE FROM ${tableName} WHERE id = '${recordId}'
  `);
}

// Helper to extract data from MotherDuck query result
function extractQueryData(result) {
  if (!result || !result.data) return [];
  
  const data = result.data;
  if (data.batches && Array.isArray(data.batches)) {
    const allRows = [];
    for (const batch of data.batches) {
      if (batch.recordBatch) {
        const recordBatch = batch.recordBatch;
        if (recordBatch.numRows !== undefined && recordBatch.numCols !== undefined) {
          const columnNames = [];
          for (let j = 0; j < recordBatch.numCols; j++) {
            if (data.columnName && typeof data.columnName === 'function') {
              columnNames.push(data.columnName(j));
            } else {
              columnNames.push(`col${j}`);
            }
          }
          
          for (let i = 0; i < recordBatch.numRows; i++) {
            const row = {};
            for (let j = 0; j < recordBatch.numCols; j++) {
              if (data.value && typeof data.value === 'function') {
                const val = data.value(j, i);
                row[columnNames[j]] = typeof val === 'bigint' ? val.toString() : val;
              }
            }
            allRows.push(row);
          }
        }
      }
    }
    return allRows;
  }
  return [];
}