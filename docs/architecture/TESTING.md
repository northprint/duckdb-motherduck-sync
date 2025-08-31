# Testing Guide - DuckDB-MotherDuck Sync

This guide explains how to test and verify the functionality of the DuckDB-MotherDuck Sync middleware.

## Prerequisites

### 1. MotherDuck Account and Token

1. Create an account at [MotherDuck](https://motherduck.com/) (free tier available)
2. Go to your dashboard and generate an API token
3. Save the token for use in testing

### 2. System Requirements

- Node.js 18 or higher
- Modern web browser (Chrome, Firefox, Safari)
- npm or yarn package manager

## Testing Methods

### Method 1: Interactive Browser Testing

This method provides a visual interface for testing all sync features.

#### Setup

```bash
# Build the main project
cd /Users/norihironarayama/duckdb-sync
npm install
npm run build

# Setup and run the test app
cd test-app
npm install
npm run dev
```

#### Usage

1. Open your browser to `http://localhost:5173`
2. Enter your MotherDuck token
3. Click "Initialize Sync Engine"
4. Use the interface to:
   - Add users to local database
   - Perform manual sync operations
   - Test offline/online transitions
   - Enable auto-sync
   - Monitor sync status and activity

#### Test Scenarios

1. **Basic Sync Flow**
   - Add a user locally
   - Click "Manual Sync"
   - Verify data is synced to MotherDuck

2. **Offline Operation**
   - Click "Go Offline"
   - Add users while offline
   - Click "Go Online"
   - Verify automatic sync occurs

3. **Conflict Resolution**
   - Create the same user ID on different sessions
   - Sync and observe conflict resolution

4. **Auto Sync**
   - Click "Start Auto Sync"
   - Add data and observe automatic synchronization
   - Monitor the activity log

### Method 2: CLI Quick Test

For rapid testing without a browser.

```bash
# From project root
npm run build
node test-cli.js
```

This runs automated tests with mock components, including:
- Initialization
- Push/Pull operations
- Full sync
- Offline behavior
- Auto-sync functionality

### Method 3: Unit Tests

Run the comprehensive test suite:

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Run in watch mode for development
npm run test:watch

# Run specific test file
npm test src/sync/engine.test.ts
```

### Method 4: Manual Integration Test

Create a simple test script:

```javascript
// test-integration.js
import { createSyncEngine, /* other imports */ } from './dist/index.js';

async function test() {
  // Your custom test code here
}

test().catch(console.error);
```

## Verification Checklist

### Core Functionality

- [ ] **Initialization**
  - Sync engine initializes without errors
  - Connection to MotherDuck is established
  - Local database tables are created

- [ ] **Data Operations**
  - Can insert records locally
  - Can update existing records
  - Can delete records
  - Changes are tracked properly

- [ ] **Sync Operations**
  - Push sends local changes to cloud
  - Pull retrieves remote changes
  - Full sync handles bidirectional updates
  - Progress indicators work correctly

- [ ] **Offline Support**
  - Operations work without network
  - Changes are queued while offline
  - Sync resumes when online
  - No data loss during transitions

- [ ] **Conflict Resolution**
  - Conflicts are detected
  - Resolution strategies work (latest-wins, local-wins, etc.)
  - No data corruption occurs

- [ ] **Performance**
  - Large datasets sync within acceptable time
  - Memory usage remains reasonable
  - Batch processing works correctly
  - Compression reduces network traffic

### Edge Cases

- [ ] Empty database sync
- [ ] Very large transactions
- [ ] Rapid offline/online transitions
- [ ] Concurrent modifications
- [ ] Network timeouts
- [ ] Invalid tokens
- [ ] Schema mismatches

## Troubleshooting

### Common Issues

1. **"Cannot find module" errors**
   ```bash
   # Ensure project is built
   npm run build
   ```

2. **MotherDuck connection fails**
   - Verify token is correct
   - Check network connectivity
   - Ensure MotherDuck service is accessible

3. **DuckDB WASM loading issues**
   - Clear browser cache
   - Check console for CORS errors
   - Verify WASM files are served correctly

4. **Type errors in tests**
   ```bash
   # Run type checking
   npm run typecheck
   ```

### Debug Mode

Enable detailed logging:

```javascript
const logger = {
  log: (level, message, context) => {
    console.log(`[${level}] ${message}`, context);
  }
};

// Pass logger to components
const syncEngine = createSyncEngine({
  // ... other options
  logger
});
```

## Performance Testing

### Load Test Example

```javascript
// Generate large dataset
const records = Array.from({ length: 10000 }, (_, i) => ({
  id: i,
  name: `User ${i}`,
  data: 'x'.repeat(100)
}));

// Measure sync time
const start = Date.now();
await syncEngine.sync();
const duration = Date.now() - start;

console.log(`Synced ${records.length} records in ${duration}ms`);
```

### Memory Monitoring

```javascript
// Monitor memory usage
const before = performance.memory.usedJSHeapSize;
await performOperation();
const after = performance.memory.usedJSHeapSize;
const used = (after - before) / 1024 / 1024;
console.log(`Operation used ${used.toFixed(2)} MB`);
```

## Environment Variables

For testing, you can set:

```bash
# MotherDuck token
export MOTHERDUCK_TOKEN="your-token-here"

# API endpoint (optional)
export MOTHERDUCK_API_URL="https://api.motherduck.com"

# Enable debug logging
export DEBUG="duckdb-sync:*"
```

## CI/CD Testing

The project includes GitHub Actions for automated testing:

```yaml
# Runs on every push and PR
- Unit tests
- Type checking
- Linting
- Build verification
- Coverage reporting
```

## Reporting Issues

When reporting test failures:

1. Include the error message and stack trace
2. Specify your environment (OS, Node version, browser)
3. Provide steps to reproduce
4. Include relevant configuration
5. Attach logs if available

## Additional Resources

- [Example Applications](./examples/)
- [API Documentation](./docs/)
- [Contributing Guide](./CONTRIBUTING.md)
- [GitHub Issues](https://github.com/northprint/duckdb-motherduck-sync/issues)