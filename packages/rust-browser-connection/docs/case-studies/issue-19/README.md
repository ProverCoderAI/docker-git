# Case Study: Issue #19 - Supporting Both Single-Language and Multi-Language Repositories in CI/CD Scripts

## Summary

This case study documents the investigation and resolution of a CI/CD pipeline failure that occurred when scripts designed for a multi-language repository structure (`./js/` subfolder) were used in a single-language repository. The root cause was identified as the `command-stream` library's implementation of `cd` as a virtual command that calls `process.chdir()`, permanently changing the Node.js process working directory.

## Background

The `link-foundation` organization maintains multiple repositories with different structures:
- **Single-language repositories**: Have `package.json` (JS) or `Cargo.toml` (Rust) in the root directory
- **Multi-language repositories**: Have language-specific code in subfolders (e.g., `./js/`, `./rust/`)

Scripts originally developed for the `link-assistant/agent` multi-language repository were causing failures when paths like `./js/package.json` didn't exist in single-language repositories.

## Original Issue: Issue #113

### CI Failure Details

**CI Run:** [#20885464993](https://github.com/link-assistant/agent/actions/runs/20885464993/job/60008012717)
**Error Message:**
```
Error: ENOENT: no such file or directory, open './js/package.json'
```

### Timeline of Events

1. **2026-01-10 22:39:00 UTC** - CI run triggered on push to main branch
2. **2026-01-10 22:39:03 UTC** - Unit tests passed on all platforms (Ubuntu, Windows, macOS)
3. **2026-01-10 22:40:29 UTC** - Release job started
4. **2026-01-10 22:40:29 UTC** - Version bump executed successfully via `cd js && npm run changeset:version`
5. **2026-01-10 22:40:29 UTC** - Script attempted to read `./js/package.json` after the `cd` command
6. **2026-01-10 22:40:29 UTC** - **FAILURE**: `ENOENT: no such file or directory, open './js/package.json'`

### The Bug: command-stream's Virtual `cd` Command

The root cause was a subtle interaction between the `command-stream` library and Node.js's process working directory:

1. **`command-stream`'s Virtual `cd` Command**: The library implements `cd` as a **virtual command** that calls `process.chdir()` on the Node.js process itself, rather than just affecting the subprocess.

2. **Working Directory Persistence**: When the script executed:
   ```javascript
   await $`cd js && npm run changeset:version`;
   ```
   The `cd js` command permanently changed the Node.js process's working directory from the repository root to the `js/` subdirectory.

3. **Subsequent File Access Failure**: After the command returned, when the script tried to read `./js/package.json`, it was looking for the file relative to the **new** working directory (`js/`), which would resolve to `js/js/package.json` - a path that doesn't exist.

### Code Flow Illustration

```
Repository Root (/)
├── js/
│   └── package.json    <- This is what we want to read
└── scripts/
    └── version-and-commit.mjs

1. Script starts with cwd = /
2. Script runs: await $`cd js && npm run changeset:version`
3. command-stream's cd command calls: process.chdir('js')
4. cwd is now /js/
5. Script tries to read: readFileSync('./js/package.json')
6. This resolves to: /js/js/package.json <- DOES NOT EXIST!
7. Error: ENOENT
```

### Why This Was Hard to Detect

- The `cd` command in most shell scripts only affects the subprocess, not the parent process
- Developers familiar with Unix shells would not expect `cd` to affect the Node.js process
- The error message didn't clearly indicate that the working directory had changed
- The `command-stream` library documentation doesn't prominently warn about this behavior

## Solution Implemented in PR #114

### 1. Working Directory Preservation and Restoration

The fix involves saving the original working directory and restoring it after any command that uses `cd`:

```javascript
// Store the original working directory
const originalCwd = process.cwd();

try {
  // ... code that uses cd ...
  await $`cd js && npm run changeset:version`;

  // Restore the original working directory
  process.chdir(originalCwd);

  // Now file operations work correctly
  const packageJson = JSON.parse(readFileSync('./js/package.json', 'utf8'));
} catch (error) {
  // Handle error
}
```

### 2. Auto-Detection of Package Root

New utility modules were created to automatically detect the package root:

**`scripts/js-paths.mjs`** - JavaScript package root detection:
```javascript
export function getJsRoot(options = {}) {
  // Check for single-language repo (package.json in root)
  if (existsSync('./package.json')) {
    return '.';
  }
  // Check for multi-language repo (package.json in js/ subfolder)
  if (existsSync('./js/package.json')) {
    return 'js';
  }
  // Error with helpful suggestions
  throw new Error('Could not find package.json...');
}
```

**`scripts/rust-paths.mjs`** - Rust package root detection:
```javascript
export function getRustRoot(options = {}) {
  // Check for single-language repo (Cargo.toml in root)
  if (existsSync('./Cargo.toml')) {
    return '.';
  }
  // Check for multi-language repo (Cargo.toml in rust/ subfolder)
  if (existsSync('./rust/Cargo.toml')) {
    return 'rust';
  }
  // Error with helpful suggestions
  throw new Error('Could not find Cargo.toml...');
}
```

### 3. Configuration Options

Scripts now support explicit configuration via:
- CLI arguments: `--js-root <path>` or `--rust-root <path>`
- Environment variables: `JS_ROOT` or `RUST_ROOT`

### Usage Examples

```bash
# Auto-detection (default)
node scripts/version-and-commit.mjs --mode changeset

# Explicit configuration
node scripts/version-and-commit.mjs --mode changeset --js-root js

# Via environment variable
JS_ROOT=js node scripts/version-and-commit.mjs --mode changeset
```

## Best Practices Identified

### 1. Working Directory Management

When using libraries that may modify process state (like `process.chdir()`):
- Always save the original state before potentially modifying operations
- Restore the original state after the operation completes
- Handle restoration in error paths as well

### 2. Multi-Language Repository Support

Following industry best practices for monorepo CI/CD:

1. **Automatic Detection**: Check for package manifests in standard locations:
   - Root directory first (single-language repo)
   - Language-specific subfolders second (multi-language repo)

2. **Explicit Configuration**: Allow overrides via CLI arguments and environment variables

3. **Helpful Error Messages**: When auto-detection fails, provide clear guidance on how to configure manually

4. **Path Abstraction**: Create utility functions that return appropriate paths based on repository structure:
   - `getPackageJsonPath()` returns `./package.json` or `js/package.json`
   - `getCargoTomlPath()` returns `./Cargo.toml` or `rust/Cargo.toml`

### 3. CI/CD Pipeline Organization

Based on research from [Buildkite](https://buildkite.com/resources/blog/monorepo-ci-best-practices/), [CircleCI](https://circleci.com/blog/monorepo-dev-practices/), and [Graphite](https://graphite.dev/guides/managing-multiple-languages-in-a-monorepo):

1. **Selective Triggering**: Use path-based filters to only run relevant jobs
2. **Caching**: Cache language-specific artifacts (node_modules, target/)
3. **Standardized Commands**: Offer unified scripts that call into the right language-specific tooling
4. **Modular Organization**: Group projects logically (frontend/, backend/, lib/shared/)

## Files Modified in PR #114

| File | Changes |
|------|---------|
| `scripts/js-paths.mjs` | New utility for JS package root detection |
| `scripts/rust-paths.mjs` | New utility for Rust package root detection |
| `scripts/version-and-commit.mjs` | Added cwd preservation and auto-detection |
| `scripts/instant-version-bump.mjs` | Added cwd preservation and auto-detection |
| `scripts/publish-to-npm.mjs` | Added cwd preservation and auto-detection |
| `scripts/rust-version-and-commit.mjs` | Added auto-detection |
| `scripts/rust-collect-changelog.mjs` | Added auto-detection |
| `scripts/rust-get-bump-type.mjs` | Added auto-detection |
| `docs/case-studies/issue-113/README.md` | Case study documentation |

## Lessons Learned

1. **Understand Library Internals**: Third-party libraries may have non-obvious behaviors. The `command-stream` library's virtual `cd` command is a powerful feature for maintaining working directory state, but it can cause issues if not handled properly.

2. **Test Edge Cases**: The CI environment differs from local development. File path handling can behave differently depending on the working directory context.

3. **Add Defensive Code**: When using commands that modify process state, always save and restore the original state.

4. **Document Non-Obvious Behaviors**: The fix includes detailed comments explaining why the `process.chdir()` restoration is necessary.

5. **Design for Multiple Repository Structures**: Scripts should be designed to work in both single-language and multi-language repository structures from the start.

## References

- [GitHub Issue #113 - JavaScript publish does not work](https://github.com/link-assistant/agent/issues/113)
- [GitHub PR #114 - Add configurable package root for release scripts](https://github.com/link-assistant/agent/pull/114)
- [CI Run #20885464993](https://github.com/link-assistant/agent/actions/runs/20885464993)
- [Node.js process.chdir() Method](https://www.geeksforgeeks.org/node-js-process-chdir-method/)
- [Monorepo CI Best Practices - Buildkite](https://buildkite.com/resources/blog/monorepo-ci-best-practices/)
- [Benefits and Challenges of Monorepo - CircleCI](https://circleci.com/blog/monorepo-dev-practices/)
- [Managing Multiple Languages in a Monorepo - Graphite](https://graphite.dev/guides/managing-multiple-languages-in-a-monorepo)
- [Monorepo Tooling in 2025](https://www.wisp.blog/blog/monorepo-tooling-in-2025-a-comprehensive-guide)

## Appendix: Data Files

The following data files were collected for this case study:

| File | Description |
|------|-------------|
| `pr-114-data/pr-details.json` | Full PR metadata including files, comments, reviews |
| `pr-114-data/pr-diff.patch` | Complete diff of changes in PR #114 |
| `pr-114-data/pr-review-comments.json` | Inline code review comments |
| `pr-114-data/pr-conversation-comments.json` | General PR discussion comments |
| `pr-114-data/pr-commits.json` | Commit history of the PR |
| `pr-114-data/issue-113-details.txt` | Original issue description |
| `pr-114-data/solution-draft-log-1.txt.gz` | AI solution draft log (first iteration, compressed) |
| `pr-114-data/solution-draft-log-2.txt.gz` | AI solution draft log (second iteration, compressed) |
| `ci-logs/ci-run-20885464993.log.gz` | Full CI run log showing the failure (compressed) |

Note: Log files are compressed with gzip to reduce repository size. Use `gunzip` to decompress.
