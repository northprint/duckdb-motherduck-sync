# Contributing to DuckDB-MotherDuck Sync

We love your input! We want to make contributing to this project as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## Development Process

We use GitHub to host code, to track issues and feature requests, as well as accept pull requests.

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes.
5. Make sure your code lints.
6. Issue that pull request!

## Development Setup

```bash
# Clone your fork
git clone https://github.com/northprint/duckdb-motherduck-sync.git
cd duckdb-motherduck-sync

# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run type checking
npm run typecheck

# Run linting
npm run lint

# Build the project
npm run build
```

## Code Style

### TypeScript Guidelines

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use `readonly` for immutable data
- Avoid `any` type - use `unknown` if type is truly unknown
- Use fp-ts patterns for error handling

### Functional Programming

This project follows functional programming principles:

```typescript
// ❌ Bad - imperative style
function processData(data: Data[]): ProcessedData[] {
  const results = [];
  for (const item of data) {
    try {
      results.push(transform(item));
    } catch (error) {
      console.error(error);
    }
  }
  return results;
}

// ✅ Good - functional style
import { pipe } from 'fp-ts/function';
import * as A from 'fp-ts/Array';
import * as TE from 'fp-ts/TaskEither';

const processData = (data: ReadonlyArray<Data>): TaskEither<Error, ReadonlyArray<ProcessedData>> =>
  pipe(
    data,
    A.traverse(TE.ApplicativePar)(item =>
      TE.tryCatch(
        () => transform(item),
        (error) => new Error(`Transform failed: ${error}`)
      )
    )
  );
```

### Testing

- Write tests for all new functionality
- Aim for >90% code coverage
- Use descriptive test names
- Group related tests with `describe` blocks

```typescript
describe('ChangeTracker', () => {
  describe('recordChange', () => {
    it('should generate unique ID for each change', async () => {
      // Test implementation
    });

    it('should include timestamp in recorded change', async () => {
      // Test implementation
    });
  });
});
```

## Pull Request Process

1. Update the README.md with details of changes to the interface, if applicable.
2. Update the examples if you're adding new features.
3. The PR will be merged once you have the sign-off of at least one maintainer.

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only changes
- `style:` - Changes that don't affect code meaning
- `refactor:` - Code change that neither fixes a bug nor adds a feature
- `perf:` - Performance improvement
- `test:` - Adding missing tests
- `chore:` - Changes to build process or auxiliary tools

Examples:
```
feat: add batch processing support
fix: resolve race condition in sync engine
docs: update API documentation
```

## Reporting Bugs

### Security Vulnerabilities

If you find a security vulnerability, please DO NOT open an issue. Email security@example.com instead.

### Bug Reports

When filing an issue, make sure to answer these questions:

1. What version are you using?
2. What environment are you running in?
3. What did you do?
4. What did you expect to see?
5. What did you see instead?

## Feature Requests

We're using GitHub Discussions for feature requests. Before creating a new discussion:

1. Check if the feature has already been requested
2. Provide a clear use case
3. Explain why existing features don't solve your problem

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## References

- [fp-ts documentation](https://gcanti.github.io/fp-ts/)
- [DuckDB WASM documentation](https://duckdb.org/docs/api/wasm)
- [MotherDuck documentation](https://motherduck.com/docs)