# Case Study: Issue #31 - Missing Crates.io Publishing

## Summary

The CI/CD pipeline correctly detects that version 0.4.0 is not published to crates.io
but fails to actually publish because there is no `cargo publish` step in the workflow.

## Timeline/Sequence of Events

### Commit History Leading to Issue

1. Issue #27 ("Rust release jobs skipped") - Identified release jobs weren't running
2. Issue #29 ("Release failed, because version check got false positive") - Fixed version
   check to use crates.io API instead of git tags
3. Issue #31 - Publishing still not working despite correct detection

### CI Run Analysis (Run #21103777967)

**Timestamp**: 2026-01-18T01:16:21Z

**Key Events**:
1. `Detect Changes` job completed
2. `Lint and Format Check` passed
3. `Test` passed on all platforms (ubuntu, macos, windows)
4. `Build Package` succeeded
5. `Auto Release` job:
   - Correctly checked crates.io API
   - Found `Published on crates.io: false`
   - Set `should_release=true` and `skip_bump=true`
   - Built release (`cargo build --release`)
   - Tried to create GitHub release (failed: tag already exists)
   - **MISSING**: No `cargo publish` step

## Root Cause Analysis

### Primary Root Cause

The `.github/workflows/rust.yml` workflow is missing the `cargo publish` step.
The workflow only:
1. Builds the release binary
2. Creates a GitHub release

But it never actually publishes to crates.io using `cargo publish`.

### Comparison with Template Repository

The template at `link-foundation/rust-ai-driven-development-pipeline-template`
includes a critical step that is missing in browser-commander:

```yaml
- name: Publish to Crates.io
  if: steps.check.outputs.should_release == 'true'
  id: publish-crate
  env:
    CARGO_TOKEN: ${{ secrets.CARGO_TOKEN }}
  run: node scripts/publish-crate.mjs
```

### Missing Files

The browser-commander repository is missing:
1. `scripts/publish-crate.mjs` - Script to publish to crates.io
2. `scripts/rust-paths.mjs` - Helper module for multi-language repo support

## Evidence from CI Logs

```
Crate: browser-commander, Version: 0.4.0, Published on crates.io: false
No changelog fragments but v0.4.0 not yet published to crates.io
```

The detection logic works correctly. The workflow then:
1. Builds the release binary (`cargo build --release`)
2. Attempts GitHub release creation (HTTP 422 - tag already exists)
3. **Does not run `cargo publish`**

## Solution

### Required Changes

1. **Add `scripts/publish-crate.mjs`**: Copy from template repository
2. **Add `scripts/rust-paths.mjs`**: Copy from template repository (required dependency)
3. **Update `.github/workflows/rust.yml`**: Add the `Publish to Crates.io` step

### Implementation Details

The `publish-crate.mjs` script:
- Reads package info from Cargo.toml
- Publishes to crates.io using `cargo publish`
- Handles "already exists" case gracefully
- Supports both single-language and multi-language repos

### Workflow Addition

Add after the `Build release` step:

```yaml
- name: Publish to Crates.io
  if: steps.check.outputs.should_release == 'true'
  id: publish-crate
  env:
    CARGO_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
  run: node scripts/publish-crate.mjs
```

## Repository Secret Requirements

The repository needs `CARGO_REGISTRY_TOKEN` (or `CARGO_TOKEN` for backward compatibility)
to be configured in repository secrets for authentication with crates.io.

## Lessons Learned

1. **Complete workflow validation**: When setting up CI/CD pipelines, verify all steps
   exist (build, test, package verification, AND publish)
2. **Template synchronization**: Regularly sync with template repositories to catch
   missing features
3. **End-to-end testing**: The version detection was tested, but the actual publish
   step was not verified to exist

## Related Issues

- #27: Rust release jobs skipped
- #29: Release failed, because version check got false positive

## References

- Template repository: https://github.com/link-foundation/rust-ai-driven-development-pipeline-template
- CI Run logs: https://github.com/link-foundation/browser-commander/actions/runs/21103777967/job/60691866177
- crates.io package: https://crates.io/crates/browser-commander (not yet published)
