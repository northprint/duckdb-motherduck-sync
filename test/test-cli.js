#!/usr/bin/env node

import { createSyncEngine, createMockDuckDBAdapter, createMockMotherDuckClient, createMockNetworkMonitor, createMemoryChangeTracker } from './dist/index.js';
import { pipe } from 'fp-ts/function';

async function testSync() {
  console.log('🧪 Testing DuckDB-MotherDuck Sync...\n');

  // Create mock components
  const networkMonitor = createMockNetworkMonitor();
  const changeTracker = createMemoryChangeTracker();
  const localDb = createMockDuckDBAdapter();
  const motherduckClient = createMockMotherDuckClient();

  // Create sync engine
  const syncEngine = createSyncEngine({
    networkMonitor,
    changeTracker,
    localDb,
    motherduckClient,
  });

  // Initialize
  console.log('1. Initializing sync engine...');
  const initResult = await pipe(
    syncEngine.initialize({
      motherduckToken: 'valid-token', // Mock accepts 'valid-token'
      tables: ['users', 'products'],
      syncInterval: 5000,
    })
  )();

  if (initResult._tag === 'Left') {
    console.error('❌ Initialization failed:', initResult.left.message);
    return;
  }
  console.log('✅ Initialized successfully\n');

  // Record some changes
  console.log('2. Recording local changes...');
  await pipe(changeTracker.recordChange({
    table: 'users',
    operation: 'INSERT',
    data: { id: '1', name: 'Alice', email: 'alice@example.com' },
  }))();

  await pipe(changeTracker.recordChange({
    table: 'users',
    operation: 'INSERT',
    data: { id: '2', name: 'Bob', email: 'bob@example.com' },
  }))();
  console.log('✅ Recorded 2 changes\n');

  // Test push
  console.log('3. Testing push operation...');
  const pushResult = await pipe(syncEngine.push())();
  if (pushResult._tag === 'Right') {
    console.log(`✅ Push successful: ${pushResult.right.uploaded} changes uploaded\n`);
  } else {
    console.error('❌ Push failed:', pushResult.left.message);
  }

  // Test pull
  console.log('4. Testing pull operation...');
  const pullResult = await pipe(syncEngine.pull())();
  if (pullResult._tag === 'Right') {
    console.log(`✅ Pull successful: ${pullResult.right.applied} changes applied\n`);
  } else {
    console.error('❌ Pull failed:', pullResult.left.message);
  }

  // Test full sync
  console.log('5. Testing full sync...');
  const syncResult = await pipe(syncEngine.sync())();
  if (syncResult._tag === 'Right') {
    console.log(`✅ Sync successful:`);
    console.log(`   - Pushed: ${syncResult.right.pushed}`);
    console.log(`   - Pulled: ${syncResult.right.pulled}`);
    console.log(`   - Duration: ${syncResult.right.duration}ms\n`);
  } else {
    console.error('❌ Sync failed:', syncResult.left.message);
  }

  // Test offline behavior
  console.log('6. Testing offline behavior...');
  networkMonitor.setState({ online: false, type: 'unknown' });
  console.log('📴 Went offline');

  await pipe(changeTracker.recordChange({
    table: 'users',
    operation: 'UPDATE',
    data: { id: '1', name: 'Alice Updated', email: 'alice@example.com' },
  }))();
  console.log('✏️  Made changes while offline');

  networkMonitor.setState({ online: true, type: 'wifi' });
  console.log('📶 Back online');

  // Start auto sync
  console.log('\n7. Testing auto sync...');
  let syncCount = 0;
  const subscription = syncEngine.syncState$.subscribe(state => {
    if (state.type === 'syncing') {
      syncCount++;
      console.log(`🔄 Auto sync #${syncCount} in progress...`);
    }
  });

  syncEngine.startAutoSync();
  console.log('▶️  Auto sync started (5 second interval)');

  // Wait for a few sync cycles
  await new Promise(resolve => setTimeout(resolve, 12000));

  syncEngine.stopAutoSync();
  subscription.unsubscribe();
  console.log('⏹️  Auto sync stopped\n');

  console.log('✅ All tests completed!');
}

// Run tests
testSync().catch(console.error);