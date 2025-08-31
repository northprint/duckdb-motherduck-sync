import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import duckdb from 'duckdb';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// MotherDuck connection
let motherduckDB = null;

// Initialize MotherDuck connection
async function initializeMotherDuck() {
  try {
    const token = process.env.MOTHERDUCK_TOKEN;
    if (!token) {
      throw new Error('MOTHERDUCK_TOKEN not set in environment variables');
    }

    // Create connection string
    const connectionString = `md:?motherduck_token=${token}`;
    
    // Create database connection
    motherduckDB = new duckdb.Database(connectionString);
    
    // Setup database
    await new Promise((resolve, reject) => {
      motherduckDB.all('CREATE DATABASE IF NOT EXISTS duckdb_sync', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    await new Promise((resolve, reject) => {
      motherduckDB.all('USE duckdb_sync', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Create tables
    await new Promise((resolve, reject) => {
      motherduckDB.all(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR PRIMARY KEY,
          name VARCHAR NOT NULL,
          email VARCHAR NOT NULL,
          created_at TIMESTAMP,
          updated_at TIMESTAMP DEFAULT NOW(),
          sync_id VARCHAR,
          source VARCHAR,
          is_deleted BOOLEAN DEFAULT false
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('MotherDuck connection initialized');
  } catch (error) {
    console.error('MotherDuck initialization failed:', error);
    throw error;
  }
}

// Helper function to execute queries
function executeQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    motherduckDB.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    motherduck: motherduckDB ? 'connected' : 'disconnected' 
  });
});

// Sync endpoint - Push changes from client
app.post('/api/sync/push', async (req, res) => {
  try {
    const { users, lastSyncTime } = req.body;
    
    if (!users || !Array.isArray(users)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const results = {
      synced: [],
      failed: [],
      conflicts: []
    };

    for (const user of users) {
      try {
        // Check for conflicts
        const existing = await executeQuery(
          'SELECT * FROM users WHERE id = ?',
          [user.id]
        );

        if (existing.length > 0 && existing[0].updated_at > user.created_at) {
          // Conflict detected
          results.conflicts.push({
            id: user.id,
            local: user,
            cloud: existing[0]
          });
        } else {
          // No conflict, proceed with upsert
          await executeQuery(`
            INSERT INTO users (id, name, email, created_at, sync_id, source) 
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              email = EXCLUDED.email,
              updated_at = NOW(),
              sync_id = EXCLUDED.sync_id
          `, [user.id, user.name, user.email, user.created_at, user.id, user.source || 'mobile']);
          
          results.synced.push(user.id);
        }
      } catch (error) {
        results.failed.push({ id: user.id, error: error.message });
      }
    }

    res.json({
      success: true,
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Sync push error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sync endpoint - Pull changes from cloud
app.post('/api/sync/pull', async (req, res) => {
  try {
    const { lastSyncTime } = req.body;
    
    let query = 'SELECT * FROM users WHERE is_deleted = false';
    const params = [];
    
    if (lastSyncTime) {
      query += ' AND updated_at > ?';
      params.push(lastSyncTime);
    }
    
    const users = await executeQuery(query, params);
    
    res.json({
      success: true,
      users,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Sync pull error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Full sync - bidirectional
app.post('/api/sync/full', async (req, res) => {
  try {
    const { users, lastSyncTime } = req.body;
    
    // First push local changes
    const pushResults = await pushChanges(users);
    
    // Then pull cloud changes
    const pullResults = await pullChanges(lastSyncTime);
    
    res.json({
      success: true,
      pushed: pushResults,
      pulled: pullResults,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Full sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
async function pushChanges(users) {
  const results = { synced: 0, failed: 0 };
  
  for (const user of users) {
    try {
      await executeQuery(`
        INSERT INTO users (id, name, email, created_at, sync_id, source) 
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          updated_at = NOW()
      `, [user.id, user.name, user.email, user.created_at, user.id, user.source || 'mobile']);
      
      results.synced++;
    } catch (error) {
      results.failed++;
    }
  }
  
  return results;
}

async function pullChanges(lastSyncTime) {
  let query = 'SELECT * FROM users WHERE is_deleted = false';
  const params = [];
  
  if (lastSyncTime) {
    query += ' AND updated_at > ?';
    params.push(lastSyncTime);
  }
  
  return await executeQuery(query, params);
}

// Resolve conflict
app.post('/api/sync/resolve-conflict', async (req, res) => {
  try {
    const { resolution, userId } = req.body;
    
    if (resolution === 'keep-local') {
      // Local version will be pushed in next sync
      res.json({ success: true, action: 'keep-local' });
    } else if (resolution === 'keep-cloud') {
      // Return cloud version to be applied locally
      const cloudUser = await executeQuery('SELECT * FROM users WHERE id = ?', [userId]);
      res.json({ success: true, action: 'keep-cloud', user: cloudUser[0] });
    } else if (resolution === 'merge') {
      // Implement merge logic as needed
      res.json({ success: true, action: 'merge' });
    }

  } catch (error) {
    console.error('Conflict resolution error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete user (soft delete)
app.delete('/api/users/:id', async (req, res) => {
  try {
    await executeQuery(
      'UPDATE users SET is_deleted = true, updated_at = NOW() WHERE id = ?',
      [req.params.id]
    );
    
    res.json({ success: true });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const users = await executeQuery('SELECT * FROM users WHERE is_deleted = false ORDER BY created_at DESC');
    res.json({ users });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
async function start() {
  try {
    await initializeMotherDuck();
    
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log('MotherDuck sync API ready');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();