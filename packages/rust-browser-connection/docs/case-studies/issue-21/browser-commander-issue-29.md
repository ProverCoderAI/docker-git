# Case Study: Issue #29 - Release Failed Due to False Positive Version Check

## Summary

The CI/CD release workflow incorrectly determined that version 0.4.0 was "already released" when the package `browser-commander` does NOT exist on crates.io at all. This is a **false positive** that prevented the release process from proceeding.

## Timeline of Events

| Timestamp (UTC) | Event |
|-----------------|-------|
| 2025-12-28T02:22:51Z | v0.1.1 - First GitHub Release created |
| 2025-12-28T02:54:13Z | v0.2.0 - GitHub Release created |
| 2025-12-28T03:48:18Z | v0.2.1 - GitHub Release created |
| 2025-12-28T04:14:37Z | v0.3.0 - GitHub Release created |
| 2025-12-28T05:13:22Z | v0.4.0 - GitHub Release created |
| 2026-01-01T04:19:55Z | v0.5.0 - GitHub Release created |
| 2026-01-09T14:04:11Z | v0.5.1 - GitHub Release created |
| 2026-01-10T01:11:29Z | v0.5.2 - GitHub Release created |
| 2026-01-10T13:40:00Z | v0.5.3 - GitHub Release created |
| 2026-01-13T20:37:18Z | v0.5.4 - GitHub Release created |
| 2026-01-17T09:43:31Z | CI Run #21092316062 started |
| 2026-01-17T09:45:29Z | **FALSE POSITIVE**: "No changelog fragments and v0.4.0 already released" |
| 2026-01-17T09:45:31Z | Release skipped (Auto Release job ended) |

## Root Cause Analysis

### The Problem

The workflow's version check logic in `.github/workflows/rust.yml` (lines 273-292) uses the following approach:

```yaml
- name: Check if version already released or no fragments
  id: check
  run: |
    if [ "${{ steps.bump_type.outputs.has_fragments }}" != "true" ]; then
      CURRENT_VERSION=$(grep -Po '(?<=^version = ")[^"]*' Cargo.toml)
      if git rev-parse "v$CURRENT_VERSION" >/dev/null 2>&1; then
        echo "No changelog fragments and v$CURRENT_VERSION already released"
        echo "should_release=false" >> $GITHUB_OUTPUT
      # ...
```

### Why This Is a False Positive

1. **Git Tag ≠ Published Package**: The workflow only checks if a git tag exists (`git rev-parse "v$CURRENT_VERSION"`), NOT whether the package was successfully published to crates.io.

2. **GitHub Release ≠ crates.io Release**: While 10 versions have GitHub releases (v0.1.1 through v0.5.4), **NONE** of them exist on crates.io:
   ```
   $ curl -s "https://crates.io/api/v1/crates/browser-commander"
   {"errors":[{"detail":"crate `browser-commander` does not exist"}]}
   ```

3. **Missing Publication Step**: The workflow creates GitHub releases but lacks `cargo publish` to actually publish to crates.io.

### Evidence from CI Logs

From `ci-run-21092316062.log` at line 4468:
```
Auto Release	UNKNOWN STEP	2026-01-17T09:45:29.1821663Z No changelog fragments and v0.4.0 already released
```

This message was triggered because:
- There were no changelog fragments (`has_fragments != "true"`)
- The git tag `v0.4.0` exists (created on 2025-12-28)
- But the version was never published to crates.io

## Impact

1. **All 10 releases are GitHub-only**: None of the versions (v0.1.1 through v0.5.4) have been published to crates.io
2. **Future releases will also fail**: Without changelog fragments, the workflow will always skip release because git tags exist
3. **Package unavailable**: Users cannot `cargo install browser-commander` or add it as a dependency

## Proposed Solutions

### Solution 1: Add crates.io Check (Recommended)

Check if the version exists on crates.io before assuming it's "already released":

```bash
# Check if package exists on crates.io
CRATE_EXISTS=$(curl -s "https://crates.io/api/v1/crates/browser-commander" | grep -c '"errors"' || true)
VERSION_EXISTS=$(curl -s "https://crates.io/api/v1/crates/browser-commander/$CURRENT_VERSION" | grep -c '"errors"' || true)

if [ "$CRATE_EXISTS" -eq 0 ] && [ "$VERSION_EXISTS" -eq 0 ]; then
  echo "Version v$CURRENT_VERSION already published to crates.io"
  echo "should_release=false" >> $GITHUB_OUTPUT
else
  echo "Version v$CURRENT_VERSION not on crates.io, proceeding with release"
  echo "should_release=true" >> $GITHUB_OUTPUT
fi
```

### Solution 2: Add cargo publish Step

Add the missing `cargo publish` step to actually publish to crates.io:

```yaml
- name: Publish to crates.io
  if: steps.check.outputs.should_release == 'true'
  env:
    CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
  run: cargo publish
```

### Solution 3: Use katyo/publish-crates Action

Use a well-tested GitHub Action for Rust publishing:

```yaml
- name: Publish to crates.io
  uses: katyo/publish-crates@v2
  with:
    registry-token: ${{ secrets.CARGO_REGISTRY_TOKEN }}
```

## Recommended Fix

Implement **all three solutions**:

1. Fix the version check logic to verify crates.io, not just git tags
2. Add `cargo publish` step to actually publish the package
3. Consider using the battle-tested `katyo/publish-crates` action

## References

- Issue: https://github.com/link-foundation/browser-commander/issues/29
- CI Run: https://github.com/link-foundation/browser-commander/actions/runs/21092316062/job/60665291821
- crates.io API: https://crates.io/api/v1/crates/browser-commander (shows crate doesn't exist)
- GitHub Releases: https://github.com/link-foundation/browser-commander/releases (shows 10 releases)
- Workflow file: `.github/workflows/rust.yml` (lines 273-292)

## Files in This Case Study

- `ci-run-21092316062.txt` - Full CI run logs (renamed from .log to avoid gitignore)
- `ci-run-21092316062-metadata.json` - CI run metadata in JSON format
- `README.md` - This analysis document
