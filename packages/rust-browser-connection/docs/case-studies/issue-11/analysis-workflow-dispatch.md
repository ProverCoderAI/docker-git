# Analysis: GitHub Actions workflow_dispatch Job Skipping Issue

## Issue Summary

- **Source Repository**: [link-foundation/lino-env](https://github.com/link-foundation/lino-env)
- **Issue**: [#24](https://github.com/link-foundation/lino-env/issues/24)
- **PR**: [#25](https://github.com/link-foundation/lino-env/pull/25)
- **Type**: Bug (jobs not running)
- **Severity**: High (release functionality broken)

## Problem Description

When triggering the workflow via `workflow_dispatch` (manual release), the release job was being skipped instead of executing. The workflow ran successfully for automatic releases but failed for manual triggers.

## Root Cause Analysis

### The Core Issue

The `detect-changes` job has this condition:
```yaml
detect-changes:
  if: github.event_name != 'workflow_dispatch'
```

This means `detect-changes` is intentionally skipped during manual triggers.

However, the `lint` job depends on `detect-changes`:
```yaml
lint:
  needs: [detect-changes]
  if: |
    github.event_name == 'push' ||
    github.event_name == 'workflow_dispatch' ||
    needs.detect-changes.outputs.rs-changed == 'true' ||
    ...
```

### GitHub Actions' Hidden Behavior

When a job dependency is skipped, the dependent job is also skipped by default - **regardless of its own `if` condition**. This happens because:

1. There's an implicit `success()` check applied to all jobs by default
2. `success()` returns `false` if any dependency was skipped
3. The job's custom `if` condition is never even evaluated

This behavior is documented in [GitHub Actions Runner Issue #491](https://github.com/actions/runner/issues/491).

### Dependency Chain Breakdown

```
detect-changes (skipped on workflow_dispatch)
       |
       v
     lint (skipped because dependency was skipped)
       |
       v
     build (skipped because lint.result != 'success')
       |
       v
manual-release (never runs because build was skipped)
```

### Why Some Jobs Worked

The `test` job had this pattern:
```yaml
test:
  needs: [detect-changes, changelog]
  if: always() && (github.event_name == 'push' || github.event_name == 'workflow_dispatch' || ...)
```

The `always()` function forces the `if` condition to be evaluated even when dependencies are skipped.

## Solution

### Fix Job Conditions

Add `always() && !cancelled()` to job conditions:

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

### Why `!cancelled()`?

Using just `always()` has a side effect: the job will run even if the workflow is cancelled. Adding `!cancelled()` ensures the job respects cancellation requests.

### Check Dependency Results Explicitly

For jobs that depend on other jobs' success:

```yaml
build:
  needs: [lint, test]
  if: |
    always() && !cancelled() &&
    needs.lint.result == 'success' &&
    needs.test.result == 'success'
```

## Best Practice Patterns

### Pattern 1: Force Evaluation but Require Success

```yaml
jobs:
  job-b:
    needs: [job-a]
    if: always() && !cancelled() && needs.job-a.result == 'success'
```

### Pattern 2: Run When Dependency Succeeded OR Skipped

```yaml
jobs:
  job-b:
    needs: [job-a]
    if: |
      always() && !cancelled() && (
        needs.job-a.result == 'success' ||
        needs.job-a.result == 'skipped'
      )
```

### Pattern 3: Run Unless Failure

```yaml
jobs:
  job-b:
    needs: [job-a]
    if: "!failure()"
```

This is simpler but less explicit about what conditions are acceptable.

## Full Example

```yaml
jobs:
  detect-changes:
    name: Detect Changes
    runs-on: ubuntu-latest
    if: github.event_name != 'workflow_dispatch'
    outputs:
      changed: ${{ steps.changes.outputs.changed }}
    steps:
      # ... detect changes

  lint:
    name: Lint
    runs-on: ubuntu-latest
    needs: [detect-changes]
    # Note: always() is required because detect-changes is skipped on workflow_dispatch
    if: |
      always() && !cancelled() && (
        github.event_name == 'workflow_dispatch' ||
        needs.detect-changes.outputs.changed == 'true'
      )
    steps:
      # ... lint code

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint]
    if: always() && !cancelled() && needs.lint.result == 'success'
    steps:
      # ... build

  release:
    name: Release
    needs: [build]
    if: |
      always() && !cancelled() &&
      github.event_name == 'workflow_dispatch' &&
      needs.build.result == 'success'
    steps:
      # ... release
```

## References

- [GitHub Actions Runner Issue #491](https://github.com/actions/runner/issues/491) - Job-level "if" condition not evaluated correctly
- [GitHub Actions Runner Issue #2205](https://github.com/actions/runner/issues/2205) - Jobs skipped when NEEDS job ran successfully
- [GitHub Community Discussion #45058](https://github.com/orgs/community/discussions/45058) - success() returns false if dependent jobs are skipped
- [GitHub Docs: Using conditions to control job execution](https://docs.github.com/en/actions/using-jobs/using-conditions-to-control-job-execution)
- [CodeStudy: GitHub Actions - Ensure Deploy Job Runs When Previous Jobs Are Skipped](https://www.codestudy.net/blog/github-action-job-fire-when-previous-job-skipped/)
