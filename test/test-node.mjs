#!/usr/bin/env node

/**
 * Node.js test script for DuckDB-MotherDuck sync
 * Run with: node test-node.mjs
 */

import duckdb from 'duckdb';
import { promises as fs } from 'fs';

// Configuration
const MOTHERDUCK_TOKEN = process.env.MOTHERDUCK_TOKEN || 'your-token-here';

async function testLocalDuckDB() {
  console.log('Testing local DuckDB...');
  
  const db = new duckdb.Database(':memory:');
  
  return new Promise((resolve, reject) => {
    db.all(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name VARCHAR,
        email VARCHAR,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) reject(err);
      
      // Insert test data
      db.run(`INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')`, (err) => {
        if (err) reject(err);
        
        db.run(`INSERT INTO users (id, name, email) VALUES (2, 'Bob', 'bob@example.com')`, (err) => {
          if (err) reject(err);
          
          // Query data
          db.all(`SELECT * FROM users`, (err, rows) => {
            if (err) reject(err);
            console.log('Local data:', rows);
            db.close();
            resolve(rows);
          });
        });
      });
    });
  });
}

async function testMotherDuckConnection() {
  console.log('\nTesting MotherDuck connection...');
  
  try {
    const db = new duckdb.Database(`md:?motherduck_token=${MOTHERDUCK_TOKEN}`);
    
    return new Promise((resolve, reject) => {
      db.all(`SELECT current_database() as db, now() as time`, (err, rows) => {
        if (err) {
          console.error('MotherDuck connection failed:', err.message);
          reject(err);
        } else {
          console.log('MotherDuck connected:', rows);
          db.close();
          resolve(rows);
        }
      });
    });
  } catch (error) {
    console.error('MotherDuck error:', error.message);
    throw error;
  }
}

async function generateSyncSQL(data) {
  console.log('\nGenerating sync SQL...');
  
  const sql = data.map(row => 
    `INSERT INTO users (id, name, email) VALUES (${row.id}, '${row.name}', '${row.email}');`
  ).join('\n');
  
  const fullSQL = `-- MotherDuck Sync SQL
-- Generated at: ${new Date().toISOString()}

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name VARCHAR,
  email VARCHAR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR DEFAULT 'node-sync'
);

${sql}
`;
  
  await fs.writeFile('sync.sql', fullSQL);
  console.log('SQL written to sync.sql');
  return fullSQL;
}

async function main() {
  console.log('DuckDB-MotherDuck Sync Test\n');
  
  try {
    // Test local DuckDB
    const localData = await testLocalDuckDB();
    
    // Generate sync SQL
    const syncSQL = await generateSyncSQL(localData);
    console.log('\nGenerated SQL preview:');
    console.log(syncSQL.substring(0, 500) + '...');
    
    // Test MotherDuck if token is provided
    if (MOTHERDUCK_TOKEN !== 'your-token-here' && MOTHERDUCK_TOKEN.startsWith('eyJ')) {
      console.log('\nTesting with provided MotherDuck token...');
      try {
        await testMotherDuckConnection();
        console.log('\nMotherDuck connection successful!');
        console.log('To sync data, execute the SQL in sync.sql on MotherDuck');
      } catch (error) {
        console.log('\nMotherDuck connection failed. This is normal if you haven\'t set up MotherDuck CLI.');
        console.log('You can still use the generated sync.sql file.');
      }
    } else {
      console.log('\nSet MOTHERDUCK_TOKEN environment variable to test MotherDuck connection');
      console.log('Example: MOTHERDUCK_TOKEN="eyJ..." node test-node.mjs');
    }
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('\nTest failed:', error.message);
    process.exit(1);
  }
}

// Run tests
main();