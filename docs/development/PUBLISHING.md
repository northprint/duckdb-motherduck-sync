# Publishing Guide

This guide explains how to publish the DuckDB-MotherDuck Sync package to npm.

## Prerequisites

1. npm account with publish permissions
2. Node.js 18 or higher
3. Clean working directory (no uncommitted changes)

## Pre-release Checklist

- [ ] All tests pass (`npm test`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Linting passes (`npm run lint`)
- [ ] Documentation is up to date
- [ ] CHANGELOG.md is updated
- [ ] Version number is bumped in package.json

## Publishing Steps

### 1. Update Version

```bash
# For patch release (bug fixes)
npm version patch

# For minor release (new features, backward compatible)
npm version minor

# For major release (breaking changes)
npm version major
```

### 2. Build and Test

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install

# Run all checks
npm run lint
npm run typecheck
npm test
npm run build
```

### 3. Test Package Locally

```bash
# Create a tarball
npm pack

# In another project, install the tarball
npm install /path/to/duckdb-motherduck-sync-0.1.0.tgz

# Test basic functionality
```

### 4. Publish to npm

```bash
# Dry run (check what will be published)
npm publish --dry-run

# Publish to npm
npm publish

# If scoped package
npm publish --access public
```

### 5. Create GitHub Release

1. Push the version tag:
   ```bash
   git push origin main --tags
   ```

2. Go to GitHub releases page
3. Click "Create a new release"
4. Select the version tag
5. Add release notes from CHANGELOG.md
6. Attach the tarball from `npm pack`
7. Publish release

### 6. Post-release

- [ ] Verify package on npmjs.com
- [ ] Test installation: `npm install duckdb-motherduck-sync`
- [ ] Update documentation if needed
- [ ] Announce release (if applicable)

## Troubleshooting

### Authentication Issues

```bash
# Login to npm
npm login

# Check current user
npm whoami
```

### Package Size Issues

```bash
# Check package size
npm pack --dry-run

# List included files
npm pack --dry-run 2>&1 | grep -E "^npm notice"
```

### Version Conflicts

```bash
# Check published versions
npm view duckdb-motherduck-sync versions

# Unpublish (within 72 hours, discouraged)
npm unpublish duckdb-motherduck-sync@0.1.0
```

## Automated Release (GitHub Actions)

The repository includes GitHub Actions for automated releases:

1. Create and push a version tag:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

2. GitHub Actions will:
   - Run tests
   - Build the package
   - Create GitHub release
   - Publish to npm (requires NPM_TOKEN secret)
   - Deploy documentation

## Security Notes

- Never commit npm tokens
- Use GitHub Secrets for CI/CD
- Enable 2FA on npm account
- Review dependencies before publishing