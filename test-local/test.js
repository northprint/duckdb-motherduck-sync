import { DuckDBSync } from 'duckdb-motherduck-sync';

console.log('Testing duckdb-motherduck-sync package...');

// Test basic import
console.log('DuckDBSync:', typeof DuckDBSync);
console.log('DuckDBSync properties:', Object.keys(DuckDBSync));

// Test instance creation (without token)
try {
  const sync = new DuckDBSync({
    autoSync: false,
    syncInterval: 60000
  });
  
  console.log('✅ Successfully created DuckDBSync instance');
  console.log('Instance methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(sync)));
} catch (error) {
  console.error('❌ Failed to create instance:', error.message);
}

console.log('\nPackage test completed!');