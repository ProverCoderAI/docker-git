# Case Study: Issue #25 - version-and-commit.rs Checks Git Tags Instead of Crates.io

## Summary

The `version-and-commit.rs` script used `git rev-parse` to check if a version tag existed, then exited early with `already_released=true` if it did. This created a permanent release pipeline failure loop when GitHub releases created tags without the crate being published to crates.io.

## Timeline of Events

| Date | Event | Detail |
|------|-------|--------|
| Prior | browser-commander releases | GitHub releases v0.1.1 through v0.8.0 created tags, but crates.io publishing failed for some |
| Prior | browser-commander#47 | Pipeline stuck at v0.4.0 on crates.io, GitHub had releases up to v0.8.0 |
| 2026-01-17 | Issue #29 (browser-commander) | First discovery of git tag vs crates.io divergence |
| 2026-01-17 | check-release-needed.rs fix | Script was updated to check crates.io API instead of git tags |
| 2026-04-13 | Issue #25 (this template) | Bug reported: version-and-commit.rs still uses git tags |

## Root Cause Analysis

### The Bug

In `version-and-commit.rs` (lines 152-154), the `check_tag_exists()` function used:

```rust
fn check_tag_exists(version: &str) -> bool {
    exec_check("git", &["rev-parse", &format!("v{}", version)])
}
```

This checked for git tags as a proxy for "already released", but git tags are not the correct source of truth for Rust package publication.

### Why Git Tags Are Unreliable

1. **GitHub releases create tags** - Creating a GitHub release via the UI or API automatically creates a git tag, even if `cargo publish` was never called
2. **Failed publishes** - If `cargo publish` fails (auth issues, network errors), the tag may already exist from a prior step
3. **Manual tag creation** - Developers or automation can create tags without publishing
4. **Tag prefix mismatches** - Multi-language repos may use different tag prefixes (e.g., `rust_v1.0.0` vs `v1.0.0`)

### The Failure Loop

```
1. version-and-commit.rs bumps version 0.4.0 → 0.4.1
2. Checks tag v0.4.1 → EXISTS (from a prior GitHub-only release)
3. Exits early WITHOUT updating Cargo.toml
4. cargo publish tries 0.4.0 → "already exists" on crates.io
5. Pipeline is permanently stuck — every run hits the same tag check
```

### Why check-release-needed.rs Was Already Correct

The `check-release-needed.rs` script (added during issue #21 investigation) already used the correct approach — querying the crates.io API:

```rust
fn check_version_on_crates_io(crate_name: &str, version: &str) -> bool {
    let url = format!("https://crates.io/api/v1/crates/{}/{}", crate_name, version);
    // HTTP 200 = published, 404 = not published
}
```

The inconsistency arose because `version-and-commit.rs` was not updated at the same time.

## Solution

### Changes Made

1. **Replaced `check_tag_exists()` with `check_version_on_crates_io()`** in `version-and-commit.rs`
   - Added `ureq`, `serde`, and `serde_json` dependencies
   - Added `get_crate_name()` helper to read crate name from Cargo.toml
   - Queries `https://crates.io/api/v1/crates/{crate_name}/{version}` API endpoint
   - Returns `true` only if crates.io confirms the version exists

2. **Added `--tag-prefix` support** to `version-and-commit.rs`
   - Configurable tag prefix (default `"v"`) for multi-language repos
   - Aligns with `create-github-release.rs` which already supports `--tag-prefix`

3. **Added test script** (`experiments/test-crates-io-check.rs`)
   - Validates the crates.io API check against known published and unpublished versions

### Design Decisions

- **On error, assume not published** - If the crates.io API is unreachable, the script assumes the version is not yet published. This is safer than incorrectly skipping a release.
- **Consistent with check-release-needed.rs** - Both scripts now use the same approach, reducing confusion and maintenance burden.

## Lessons Learned

1. **Use the authoritative source of truth** - For Rust packages, crates.io is the source of truth, not git tags
2. **Keep related scripts consistent** - When fixing a pattern in one script, audit all scripts for the same anti-pattern
3. **Test with real API calls** - The experiment script validates the fix against actual crates.io data
4. **Multi-language repos need tag prefixes** - Hard-coded `v` prefix breaks in monorepos with multiple languages

## Related Issues

- [browser-commander#47](https://github.com/link-foundation/browser-commander/issues/47) - Original discovery of the stuck pipeline
- [browser-commander#29](https://github.com/link-foundation/browser-commander/issues/29) - First fix for git tag vs crates.io check
- [Issue #21](../issue-21/) - Previous case study covering the same category of CI/CD issues
