/**
 * DuckDB-MotherDuck Sync Library
 * 
 * シンプルな同期ライブラリ - MotherDuckトークンだけで動作
 */

interface DuckDBSyncConfig {
  motherduckToken?: string | null;
  syncInterval?: number;
  autoSync?: boolean;
  syncWorkerPath?: string;
  wasmPath?: string;
  workerPath?: string;
}

interface Change {
  id: string;
  table_name: string;
  record_id: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  data: any;
  created_at: Date;
  synced: boolean;
}

interface SyncResult {
  pushed?: any[];
  pulled?: any[];
}

class DuckDBSync {
  private config: Required<DuckDBSyncConfig>;
  private db: any = null;
  private conn: any = null;
  private syncWorker: Worker | null = null;
  private syncInProgress: boolean = false;
  private listeners: Map<string, Array<(data?: any) => void>> = new Map();
  private syncInterval: NodeJS.Timeout | null = null;

  constructor(config: DuckDBSyncConfig = {}) {
    this.config = {
      motherduckToken: config.motherduckToken || null,
      syncInterval: config.syncInterval || 30000, // 30 seconds
      autoSync: config.autoSync !== false,
      syncWorkerPath: config.syncWorkerPath || '/public/duckdb-sync-worker.js',
      wasmPath: config.wasmPath || '',
      workerPath: config.workerPath || '',
    };
  }

  /**
   * Initialize local DuckDB
   */
  async initialize(): Promise<void> {
    // Dynamic import to avoid bundling issues
    const duckdb = await import('@duckdb/duckdb-wasm');
    
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const DUCKDB_CONFIG = await duckdb.selectBundle({
      mvp: {
        mainModule: this.config.wasmPath || `${baseUrl}/node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm`,
        mainWorker: this.config.workerPath || `${baseUrl}/node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js`,
      },
      eh: {
        mainModule: this.config.wasmPath || `${baseUrl}/node_modules/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm`,
        mainWorker: this.config.workerPath || `${baseUrl}/node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js`,
      },
    });
    
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const worker = new Worker(DUCKDB_CONFIG.mainWorker!);
    
    this.db = new duckdb.AsyncDuckDB(logger, worker);
    await this.db.instantiate(DUCKDB_CONFIG.mainModule, DUCKDB_CONFIG.pthreadWorker);
    
    this.conn = await this.db.connect();
    
    // Initialize sync metadata table
    await this.conn.query(`
      CREATE TABLE IF NOT EXISTS _sync_metadata (
        table_name VARCHAR PRIMARY KEY,
        last_sync TIMESTAMP,
        sync_version INTEGER DEFAULT 0
      )
    `);
    
    await this.conn.query(`
      CREATE TABLE IF NOT EXISTS _sync_changes (
        id VARCHAR PRIMARY KEY,
        table_name VARCHAR NOT NULL,
        record_id VARCHAR NOT NULL,
        operation VARCHAR NOT NULL,
        data JSON,
        created_at TIMESTAMP DEFAULT NOW(),
        synced BOOLEAN DEFAULT false
      )
    `);
    
    // Initialize sync worker if token is provided
    if (this.config.motherduckToken) {
      await this.initializeSyncWorker();
    }
    
    this.emit('initialized');
  }

  /**
   * Initialize sync worker
   */
  async initializeSyncWorker(): Promise<void> {
    this.syncWorker = new Worker(this.config.syncWorkerPath, { type: 'module' });
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker initialization timeout')), 10000);
      
      if (this.syncWorker) {
        this.syncWorker.onmessage = (event: MessageEvent) => {
          if (event.data.type === 'INITIALIZED') {
            clearTimeout(timeout);
            if (this.syncWorker) {
              this.syncWorker.onmessage = this.handleWorkerMessage.bind(this);
            }
            
            if (this.config.autoSync) {
              this.startAutoSync();
            }
            
            resolve();
          } else if (event.data.type === 'ERROR') {
            clearTimeout(timeout);
            reject(new Error(event.data.error));
          }
        };
        
        this.syncWorker.postMessage({
          type: 'INITIALIZE',
          token: this.config.motherduckToken
        });
      }
    });
  }

  /**
   * Track table for sync
   */
  async trackTable(tableName: string, options: { trackQuery?: string } = {}): Promise<void> {
    const trackQuery = options.trackQuery || `
      CREATE TRIGGER IF NOT EXISTS ${tableName}_sync_trigger
      AFTER INSERT OR UPDATE OR DELETE ON ${tableName}
      BEGIN
        INSERT INTO _sync_changes (id, table_name, record_id, operation, data)
        VALUES (
          'change_' || strftime('%s', 'now') || '_' || random(),
          '${tableName}',
          CASE 
            WHEN NEW.id IS NOT NULL THEN NEW.id
            ELSE OLD.id
          END,
          CASE
            WHEN OLD.id IS NULL THEN 'INSERT'
            WHEN NEW.id IS NULL THEN 'DELETE'
            ELSE 'UPDATE'
          END,
          CASE
            WHEN NEW.id IS NOT NULL THEN to_json(NEW)
            ELSE to_json(OLD)
          END
        );
      END;
    `;
    
    await this.conn.query(trackQuery);
    
    // Add to sync metadata
    await this.conn.query(`
      INSERT INTO _sync_metadata (table_name) 
      VALUES ('${tableName}')
      ON CONFLICT (table_name) DO NOTHING
    `);
    
    this.emit('table-tracked', { tableName });
  }

  /**
   * Get connection for direct queries
   */
  getConnection(): any {
    return this.conn;
  }

  /**
   * Execute query
   */
  async query(sql: string, params: any[] = []): Promise<any[]> {
    const result = await this.conn.query(sql, params);
    return result.toArray();
  }

  /**
   * Sync now
   */
  async sync(): Promise<void> {
    if (!this.syncWorker) {
      throw new Error('Sync not configured. Please provide MotherDuck token.');
    }
    
    if (this.syncInProgress) {
      return;
    }
    
    this.syncInProgress = true;
    this.emit('sync-start');
    
    try {
      // Get pending changes
      const changes = await this.conn.query(`
        SELECT * FROM _sync_changes WHERE NOT synced
        ORDER BY created_at
      `);
      const pendingChanges: Change[] = changes.toArray();
      
      if (pendingChanges.length === 0) {
        this.emit('sync-complete', { changes: 0 });
        return;
      }
      
      // Get table schemas
      const tables = await this.conn.query(`
        SELECT DISTINCT table_name FROM _sync_metadata
      `);
      const tableNames: string[] = tables.toArray().map((t: any) => t.table_name);
      
      const schemas: Record<string, any[]> = {};
      for (const tableName of tableNames) {
        const schema = await this.conn.query(`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_name = '${tableName}'
        `);
        schemas[tableName] = schema.toArray();
      }
      
      // Send to worker
      const result = await this.sendToWorker({
        type: 'SYNC',
        changes: pendingChanges,
        schemas
      });
      
      // Mark as synced
      for (const change of pendingChanges) {
        await this.conn.query(`
          UPDATE _sync_changes SET synced = true WHERE id = '${change.id}'
        `);
      }
      
      // Pull changes from cloud
      if (result.pulled && result.pulled.length > 0) {
        await this.applyPulledChanges(result.pulled);
      }
      
      this.emit('sync-complete', {
        pushed: pendingChanges.length,
        pulled: result.pulled ? result.pulled.length : 0
      });
      
    } catch (error) {
      this.emit('sync-error', error);
      throw error;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Apply pulled changes
   */
  async applyPulledChanges(changes: any[]): Promise<void> {
    for (const change of changes) {
      try {
        const { table_name, operation, data } = change;
        
        if (operation === 'INSERT') {
          const columns = Object.keys(data).join(', ');
          const values = Object.values(data).map(v => 
            typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v
          ).join(', ');
          
          await this.conn.query(`
            INSERT INTO ${table_name} (${columns}) 
            VALUES (${values})
            ON CONFLICT DO UPDATE SET ${
              Object.keys(data).map(k => `${k} = EXCLUDED.${k}`).join(', ')
            }
          `);
        }
        // Handle UPDATE and DELETE as needed
      } catch (error) {
        console.error('Error applying change:', error);
      }
    }
  }

  /**
   * Send message to worker
   */
  sendToWorker(message: any): Promise<SyncResult> {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).substring(2, 11);
      
      const handler = (event: MessageEvent) => {
        if (event.data.id === id) {
          if (this.syncWorker) {
            this.syncWorker.removeEventListener('message', handler);
          }
          
          if (event.data.type === 'SUCCESS') {
            resolve(event.data.result);
          } else {
            reject(new Error(event.data.error));
          }
        }
      };
      
      if (this.syncWorker) {
        this.syncWorker.addEventListener('message', handler);
        this.syncWorker.postMessage({ ...message, id });
      }
    });
  }

  /**
   * Handle worker messages
   */
  handleWorkerMessage(event: MessageEvent): void {
    // Handle async messages from worker
    if (event.data.type === 'SYNC_STATUS') {
      this.emit('sync-status', event.data);
    }
  }

  /**
   * Start auto sync
   */
  startAutoSync(): void {
    this.stopAutoSync();
    
    this.syncInterval = setInterval(() => {
      if (navigator.onLine) {
        this.sync().catch(console.error);
      }
    }, this.config.syncInterval);
  }

  /**
   * Stop auto sync
   */
  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Event handling
   */
  on(event: string, callback: (data?: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: (data?: any) => void): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event: string, data?: any): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }

  /**
   * Cleanup
   */
  async destroy(): Promise<void> {
    this.stopAutoSync();
    
    if (this.syncWorker) {
      this.syncWorker.terminate();
    }
    
    if (this.conn) {
      await this.conn.close();
    }
    
    if (this.db) {
      await this.db.terminate();
    }
  }
}

// Export for ES modules
export { DuckDBSync };

// Export for CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DuckDBSync };
}