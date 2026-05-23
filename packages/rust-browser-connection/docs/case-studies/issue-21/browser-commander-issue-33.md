# Case Study: Issue #33 - Organization Secret CARGO_TOKEN Was Not Applied in Rust Release CI/CD

## Summary

After PR #32 added the `cargo publish` step to the workflow, the release still failed to publish to crates.io. The root cause is a **mismatch between the organization secret name (`CARGO_TOKEN`) and the workflow's secret reference (`secrets.CARGO_REGISTRY_TOKEN`)**.

## Timeline/Sequence of Events

### Commit History Leading to Issue

1. **Issue #27** ("Rust release jobs skipped") - Identified release jobs weren't running
2. **Issue #29** ("Release failed, because version check got false positive") - Fixed version check to use crates.io API instead of git tags
3. **Issue #31** ("No actual publishing to crates.io") - Identified missing `cargo publish` step
4. **PR #32** - Added `publish-crate.mjs` script and workflow step to publish to crates.io
5. **Issue #33** (this issue) - Despite the fix in PR #32, publishing still fails due to secret name mismatch

### CI Run Analysis (Run #21116038007)

**Timestamp**: 2026-01-18T17:49:49Z
**Trigger**: Push to main (merge of PR #32)
**Head SHA**: b7d1eeab81f5df24ad9f3209950f9d312833659d

**Key Events**:
1. `Detect Changes` job completed successfully
2. `Lint and Format Check` passed
3. `Test` passed on all platforms (ubuntu, macos, windows)
4. `Build Package` succeeded
5. `Auto Release` job:
   - Checked crates.io API - Found `Published on crates.io: false`
   - Set `should_release=true` and `skip_bump=true`
   - Built release (`cargo build --release`)
   - **Attempted `Publish to Crates.io`** - **FAILED** with "please provide a non-empty token"
   - Created GitHub Release (HTTP 422 - tag already exists)

### Critical Log Evidence

From the CI logs at line 4912:
```
Auto Release	Publish to Crates.io	2026-01-18T17:53:52.6733565Z   CARGO_REGISTRY_TOKEN:
```

The `CARGO_REGISTRY_TOKEN` environment variable is **empty** (notice there's nothing after the colon).

From line 4918:
```
##[warning]Neither CARGO_REGISTRY_TOKEN nor CARGO_TOKEN is set, attempting publish without explicit token
```

From lines 4942-4945:
```
error: failed to publish browser-commander v0.4.0 to registry at https://crates.io

Caused by:
  please provide a non-empty token
```

## Root Cause Analysis

### Primary Root Cause

**The workflow references `secrets.CARGO_REGISTRY_TOKEN` but the organization secret is named `CARGO_TOKEN`.**

In `.github/workflows/rust.yml` (lines 325-331 for auto-release, lines 397-403 for manual-release):
```yaml
- name: Publish to Crates.io
  if: steps.check.outputs.should_release == 'true'
  id: publish-crate
  env:
    CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}  # <-- References CARGO_REGISTRY_TOKEN
  working-directory: .
  run: node rust/scripts/publish-crate.mjs
```

The organization has set up a secret named `CARGO_TOKEN`, not `CARGO_REGISTRY_TOKEN`. When the workflow tries to access `secrets.CARGO_REGISTRY_TOKEN`, GitHub returns an empty string because no secret with that exact name exists.

### Contributing Factor: Misleading Script Behavior

The `publish-crate.mjs` script has confusing error handling. Despite the cargo command failing with "please provide a non-empty token", the CI job shows "conclusion":"success". This is because:

1. The script attempts to publish without a token when none is provided
2. The cargo error is printed to stdout/stderr
3. But the error propagation from the `command-stream` library may not be handling this specific error case properly

This masking of the failure made the overall CI run show as "success" despite the actual publishing failure.

### Naming Convention Context

According to [Cargo documentation](https://doc.rust-lang.org/cargo/reference/registries.html):
- **`CARGO_REGISTRY_TOKEN`** is the official environment variable name for crates.io authentication
- **`CARGO_TOKEN`** is a commonly used alternative name in CI/CD templates

The issue-31 case study recommended using `CARGO_REGISTRY_TOKEN` in the workflow (which is the correct Cargo convention), but the organization secret was created with the name `CARGO_TOKEN`.

## Solution

### Option 1: Update Workflow to Use Existing Secret Name (Recommended)

Change the workflow to reference the existing organization secret `CARGO_TOKEN`:

```yaml
- name: Publish to Crates.io
  if: steps.check.outputs.should_release == 'true'
  id: publish-crate
  env:
    CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}  # Use CARGO_TOKEN org secret
  working-directory: .
  run: node rust/scripts/publish-crate.mjs
```

This maps the organization secret `CARGO_TOKEN` to the environment variable `CARGO_REGISTRY_TOKEN` that Cargo expects.

### Option 2: Rename Organization Secret

Alternatively, rename the organization secret from `CARGO_TOKEN` to `CARGO_REGISTRY_TOKEN` in the GitHub organization settings.

**Note:** Option 1 is recommended as it doesn't require organization admin access and maintains backward compatibility with other repositories that may use `CARGO_TOKEN`.

### Secondary Fix: Improve Error Handling in publish-crate.mjs

The script should fail explicitly when:
1. No token is provided and the publish fails
2. The "non-empty token" error is detected

## Files Changed

1. **`.github/workflows/rust.yml`**: Change `${{ secrets.CARGO_REGISTRY_TOKEN }}` to `${{ secrets.CARGO_TOKEN }}` in both `auto-release` and `manual-release` jobs

## Verification Steps

After the fix:
1. Merge the PR to main
2. Check the CI run for the `Publish to Crates.io` step
3. Verify the environment shows `CARGO_REGISTRY_TOKEN: ***` (masked, indicating a value is present)
4. Verify no "Neither CARGO_REGISTRY_TOKEN nor CARGO_TOKEN is set" warning appears
5. Verify the package appears on https://crates.io/crates/browser-commander

## Lessons Learned

1. **Secret names must match exactly**: GitHub secrets are case-sensitive and must be referenced by their exact names
2. **Naming conventions matter**: When following templates, ensure secret names are consistent across the organization
3. **CI success can be misleading**: A "successful" CI run doesn't guarantee all steps actually succeeded - always check the logs
4. **Defense in depth**: Error handling in scripts should be explicit about authentication failures

## Related Issues

- #27: Rust release jobs skipped
- #29: Release failed, because version check got false positive
- #31: I see not actual publishing to crates.io (PR #32 attempted to fix)

## References

- GitHub Organization Secrets: https://docs.github.com/actions/security-guides/using-secrets-in-github-actions
- Cargo Registry Configuration: https://doc.rust-lang.org/cargo/reference/registries.html
- CI Run logs: https://github.com/link-foundation/browser-commander/actions/runs/21116038007/job/60721745091
- PR #32: https://github.com/link-foundation/browser-commander/pull/32
- crates.io package: https://crates.io/crates/browser-commander (not yet published)
