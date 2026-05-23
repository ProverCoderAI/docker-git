# Analysis: crates.io Publishing Support

## Issue Summary

- **Source Repository**: [link-foundation/lino-env](https://github.com/link-foundation/lino-env)
- **Issue**: [#22](https://github.com/link-foundation/lino-env/issues/22)
- **PR**: [#23](https://github.com/link-foundation/lino-env/pull/23)
- **Type**: Feature (new functionality)

## Problem Description

The Rust CI/CD workflow only created GitHub releases but didn't publish packages to crates.io, making it incomplete compared to the JavaScript workflow which publishes to npm.

## Solution Overview

### Option 1: Traditional API Token Approach

Uses a manually created crates.io API token stored as a GitHub secret.

**Workflow Addition:**
```yaml
env:
  CARGO_TOKEN: ${{ secrets.CARGO_TOKEN }}

jobs:
  release:
    steps:
      - name: Publish to Crates.io
        run: |
          PACKAGE_NAME=$(grep '^name = ' Cargo.toml | head -1 | sed 's/name = "\(.*\)"/\1/')
          PACKAGE_VERSION=$(grep '^version = ' Cargo.toml | head -1 | sed 's/version = "\(.*\)"/\1/')
          echo "Package: $PACKAGE_NAME@$PACKAGE_VERSION"

          set +e  # Don't exit on error
          cargo publish --token ${{ secrets.CARGO_TOKEN }} --allow-dirty 2>&1 | tee publish_output.txt
          PUBLISH_EXIT_CODE=$?
          set -e

          if [ $PUBLISH_EXIT_CODE -eq 0 ]; then
            echo "Successfully published to crates.io"
          elif grep -q "already uploaded" publish_output.txt || grep -q "already exists" publish_output.txt; then
            echo "Version already exists on crates.io - this is OK"
          else
            echo "Failed to publish"
            exit 1
          fi
```

**Setup:**
1. Go to [crates.io API tokens](https://crates.io/settings/tokens)
2. Create a new token with publish permissions
3. Add it as a repository secret named `CARGO_TOKEN`

### Option 2: Trusted Publishing (Recommended for 2025+)

Uses OIDC for secure, tokenless publishing. This is now the recommended approach.

**Workflow:**
```yaml
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      id-token: write  # Required for OIDC token exchange
    steps:
      - uses: actions/checkout@v4
      - uses: rust-lang/crates-io-auth-action@v1
        id: auth
      - name: Publish to Crates.io
        run: cargo publish
        env:
          CARGO_REGISTRY_TOKEN: ${{ steps.auth.outputs.token }}
```

**Setup:**
1. Go to crates.io package settings
2. Configure trusted publishing for your GitHub repository
3. No manual token needed - OIDC handles authentication

**Benefits of Trusted Publishing:**
- No long-lived secrets to manage
- Tokens are short-lived (30 minutes)
- More secure against credential leaks
- Easier to set up and maintain

## Handling Edge Cases

### Version Already Exists

When a version is already published, `cargo publish` returns an error. Handle gracefully:

```bash
if grep -q "already uploaded" publish_output.txt || grep -q "already exists" publish_output.txt; then
  echo "Version already exists on crates.io - this is OK"
  # Don't fail the workflow
fi
```

### Dry Run Testing

Before releasing, test with dry run:

```bash
cargo publish --dry-run
```

### Workspace Publishing

For monorepos with multiple crates, consider:
- Publishing crates in dependency order
- Using `cargo publish -p crate-name` for specific packages
- Using tools like `cargo-release` or `cargo-workspaces`

## Release Script Updates

The `create-github-release.mjs` script was updated to support crates.io:

```javascript
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('tag-prefix', {
        type: 'string',
        default: getenv('TAG_PREFIX', 'v'),
        describe: 'Tag prefix (e.g., "v" or "rust-v")',
      })
      .option('crates-io-url', {
        type: 'string',
        default: getenv('CRATES_IO_URL', ''),
        describe: 'Crates.io package URL to include in release notes',
      }),
});

// Add crates.io link to release notes
if (cratesIoUrl) {
  releaseNotes = `${cratesIoUrl}\n\n${releaseNotes}`;
}
```

**Usage:**
```bash
node scripts/create-github-release.mjs \
  --release-version "1.0.0" \
  --repository "owner/repo" \
  --tag-prefix "rust-v" \
  --crates-io-url "https://crates.io/crates/package-name"
```

## Complete Workflow Example

```yaml
name: Rust CI/CD

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      bump_type:
        description: 'Version bump type'
        type: choice
        options: [patch, minor, major]

env:
  CARGO_TOKEN: ${{ secrets.CARGO_TOKEN }}

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - uses: dtolnay/rust-toolchain@stable

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Version and commit
        id: version
        run: node scripts/version-and-commit.mjs --bump-type "${{ inputs.bump_type }}"

      - name: Build release
        if: steps.version.outputs.version_committed == 'true'
        run: cargo build --release

      - name: Publish to Crates.io
        if: steps.version.outputs.version_committed == 'true'
        run: |
          set +e
          cargo publish --token ${{ secrets.CARGO_TOKEN }} --allow-dirty 2>&1 | tee publish_output.txt
          PUBLISH_EXIT_CODE=$?
          set -e

          if [ $PUBLISH_EXIT_CODE -eq 0 ]; then
            echo "Successfully published"
          elif grep -q "already" publish_output.txt; then
            echo "Version already exists - OK"
          else
            exit 1
          fi

      - name: Create GitHub Release
        if: steps.version.outputs.version_committed == 'true'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          PACKAGE_NAME=$(grep '^name = ' Cargo.toml | head -1 | sed 's/name = "\(.*\)"/\1/')
          node scripts/create-github-release.mjs \
            --release-version "${{ steps.version.outputs.new_version }}" \
            --repository "${{ github.repository }}" \
            --crates-io-url "https://crates.io/crates/$PACKAGE_NAME"
```

## References

- [crates.io Trusted Publishing Documentation](https://crates.io/docs/trusted-publishing)
- [RFC #3691: Trusted Publishing for crates.io](https://rust-lang.github.io/rfcs/3691-trusted-publishing-cratesio.html)
- [rust-lang/crates-io-auth-action](https://github.com/rust-lang/crates-io-auth-action)
- [How to Automate Publishing your Crates with GitHub Actions](https://fassbender.dev/blog/001-cargo-publish-action/)
- [katyo/publish-crates GitHub Action](https://github.com/katyo/publish-crates)
