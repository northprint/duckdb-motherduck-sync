/**
 * Simple JavaScript entry point for npm package
 * 
 * Re-exports the class-based API for easy usage
 */

// Export the class-based API
export { DuckDBSync } from './duckdb-sync';


// Default export for convenience
import { DuckDBSync } from './duckdb-sync';
export default DuckDBSync;