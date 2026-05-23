# Case Study: Rust Release Jobs Skipped (Issue #27)

## Timeline of Events

### 2026-01-16 17:09:55 UTC - Run ID 21074589083
- **Event**: `workflow_dispatch` (manual trigger)
- **Result**: Pipeline completed but release jobs were skipped
- **Jobs Status**:
  - Detect Changes: SKIPPED (expected - has `if: github.event_name != 'workflow_dispatch'`)
  - Test (all platforms): SUCCESS
  - Changelog Fragment Check: SKIPPED
  - **Lint and Format Check: SKIPPED** (unexpected)
  - **Build Package: SKIPPED** (unexpected - depends on lint)
  - **Manual Release: SKIPPED** (unexpected - depends on build)
  - Auto Release: SKIPPED (expected - only on push to main)

### 2026-01-10 13:38:44 UTC - Run ID 20879147120
- **Event**: `push` to main branch
- **Result**: Build succeeded but Auto Release was skipped
- **Jobs Status**:
  - Detect Changes: SUCCESS
  - Lint and Format Check: SUCCESS
  - Test (all platforms): SUCCESS
  - Build Package: SUCCESS
  - **Auto Release: SKIPPED** (unexpected)

## Root Cause Analysis

### Primary Root Cause: Missing `always()` in Job Conditions

The GitHub Actions workflow has a fundamental issue with job dependency evaluation. When a job is skipped, all jobs that depend on it are also skipped by default unless they use `always()` in their condition.

**The Problematic Pattern (current):**
```yaml
lint:
  needs: [detect-changes]
  if: |
    github.event_name == 'push' ||
    github.event_name == 'workflow_dispatch' ||
    needs.detect-changes.outputs.rs-changed == 'true' ||
    ...
```

**The Correct Pattern (from template):**
```yaml
lint:
  needs: [detect-changes]
  if: |
    always() && !cancelled() && (
      github.event_name == 'push' ||
      github.event_name == 'workflow_dispatch' ||
      needs.detect-changes.outputs.rs-changed == 'true' ||
      ...
    )
```

### Chain Reaction

1. On `workflow_dispatch`, `detect-changes` is skipped (by design)
2. Without `always()`, `lint` job is automatically skipped when its dependency is skipped
3. `build` depends on `lint`, so it's also skipped
4. `manual-release` depends on `build`, so it's also skipped

### Secondary Root Cause: Inconsistent Condition for Auto Release

The `auto-release` job has the condition:
```yaml
if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

But it lacks `always() && !cancelled()` prefix and `needs.build.result == 'success'` verification, which can cause issues when upstream jobs use `always()`.

## Solution

### 1. Add `always() && !cancelled()` to All Dependent Jobs

Jobs that depend on `detect-changes` need the pattern:
```yaml
if: |
  always() && !cancelled() && (
    github.event_name == 'push' ||
    github.event_name == 'workflow_dispatch' ||
    ...
  )
```

This ensures:
- `always()` - Job runs even when dependencies are skipped
- `!cancelled()` - Job doesn't run if workflow was cancelled
- The actual condition determines if job should run

### 2. Add Result Verification for Release Jobs

Release jobs should verify upstream jobs succeeded:
```yaml
auto-release:
  if: |
    always() && !cancelled() &&
    github.event_name == 'push' &&
    github.ref == 'refs/heads/main' &&
    needs.build.result == 'success'
```

## Reference

- [GitHub Actions: Jobs that use `always()` need dependencies to also use it](https://github.com/actions/runner/issues/491)
- [Template Repository Best Practices](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template)

## Affected Files

1. `.github/workflows/rust.yml` - Main workflow file needing fixes
2. `rust/scripts/get-bump-type.mjs` - Currently works with `rust/changelog.d`, needs update for monorepo structure

## Fix Implementation

See the PR for the complete fix that aligns with the template repository best practices.
