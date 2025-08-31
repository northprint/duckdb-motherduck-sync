// Simple change tracker for testing
export function createSimpleChangeTracker(db) {
  const changes = [];
  
  return {
    recordChange: async (change) => {
      const fullChange = {
        id: Date.now().toString(),
        ...change,
        timestamp: Date.now(),
      };
      
      try {
        const conn = await db.connect();
        
        // Store in memory
        changes.push(fullChange);
        
        // Also store in database
        const sql = `
          INSERT INTO _sync_changes (id, table_name, operation, timestamp, data, old_data, synced)
          VALUES ('${fullChange.id}', '${fullChange.table}', '${fullChange.operation}', 
                  ${fullChange.timestamp}, '${JSON.stringify(fullChange.data).replace(/'/g, "''")}', 
                  ${fullChange.oldData ? `'${JSON.stringify(fullChange.oldData).replace(/'/g, "''")}'` : 'NULL'}, 0)
        `;
        
        await conn.query(sql);
        await conn.close();
        
        return { _tag: 'Right', right: fullChange };
      } catch (error) {
        console.error('Error recording change:', error);
        return { _tag: 'Left', left: { type: 'unknown-error', message: error.message, error } };
      }
    },
    
    getUnsyncedChanges: () => {
      return async () => {
        try {
          const conn = await db.connect();
          const result = await conn.query(`
            SELECT id, table_name, operation, timestamp, data, old_data
            FROM _sync_changes
            WHERE synced = 0
            ORDER BY timestamp ASC
          `);
          
          const changes = result.toArray().map(row => ({
            id: row.id,
            table: row.table_name,
            operation: row.operation,
            timestamp: row.timestamp,
            data: JSON.parse(row.data),
            oldData: row.old_data ? JSON.parse(row.old_data) : undefined,
          }));
          
          await conn.close();
          console.log('Found unsynced changes:', changes.length);
          return { _tag: 'Right', right: changes };
        } catch (error) {
          console.error('Error getting unsynced changes:', error);
          return { _tag: 'Left', left: { type: 'unknown-error', message: error.message, error } };
        }
      };
    },
    
    markSynced: (changeIds) => {
      return async () => {
        try {
          if (changeIds.length === 0) {
            return { _tag: 'Right', right: undefined };
          }
          
          const conn = await db.connect();
          const idList = changeIds.map(id => `'${id}'`).join(', ');
          await conn.query(`
            UPDATE _sync_changes
            SET synced = 1
            WHERE id IN (${idList})
          `);
          await conn.close();
          
          console.log('Marked as synced:', changeIds.length);
          return { _tag: 'Right', right: undefined };
        } catch (error) {
          console.error('Error marking synced:', error);
          return { _tag: 'Left', left: { type: 'unknown-error', message: error.message, error } };
        }
      };
    },
    
    clearHistory: async (before) => {
      return () => Promise.resolve({ _tag: 'Right', right: undefined });
    }
  };
}