# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2024-08-24

### Added

- Initial release of DuckDB-MotherDuck Sync Middleware
- Bidirectional synchronization between DuckDB WASM and MotherDuck
- Offline-first architecture with automatic sync on reconnection
- Multiple conflict resolution strategies (local-wins, remote-wins, latest-wins, manual)
- Change tracking with SQL-based persistence
- Network monitoring with automatic sync triggers
- Table filtering for selective synchronization
- Batch processing for large datasets
- Optional gzip compression for network transfers
- Web Worker support for background processing
- Comprehensive TypeScript types with fp-ts
- Runtime validation with io-ts
- Reactive state management with RxJS

### Features

#### Core Functionality
- `SyncEngine` for orchestrating sync operations
- `ChangeTracker` for recording local modifications
- `NetworkMonitor` for connectivity detection
- `ConflictResolver` for handling sync conflicts

#### Adapters
- DuckDB WASM adapter with transaction support
- MotherDuck client with retry logic
- Storage adapters (IndexedDB, Memory)

#### Performance Optimizations
- Batch processing with configurable batch sizes
- Compression support with threshold configuration
- Web Worker pool for parallel processing
- Incremental sync with timestamp tracking

#### Developer Experience
- Full TypeScript support with strict mode
- Functional programming patterns with fp-ts
- Comprehensive test suite (>90% coverage target)
- Detailed API documentation
- Example applications

### Security
- Secure token management
- No credentials stored in plain text
- Encrypted storage adapter support

[0.1.0]: https://github.com/northprint/duckdb-motherduck-sync/releases/tag/v0.1.0