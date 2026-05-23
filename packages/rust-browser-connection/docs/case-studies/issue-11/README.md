# Case Study: Issue #11 - Apply Best Practices from Other Repositories

## Summary

This case study analyzes best practices discovered in several link-foundation repositories and applies them to the `rust-ai-driven-development-pipeline-template`. The goal is to improve the Rust CI/CD pipeline by incorporating lessons learned from real-world issues.

## Referenced Pull Requests

| Repository | PR | Title | Key Fix |
|------------|-----|-------|---------|
| [link-foundation/start](https://github.com/link-foundation/start) | [#58](https://github.com/link-foundation/start/pull/58) | fix: Use 'close' event instead of 'exit' for reliable stdout capture | CI/CD changelog check bug fix |
| [link-foundation/lino-env](https://github.com/link-foundation/lino-env) | [#27](https://github.com/link-foundation/lino-env/pull/27) | fix(rust): remove deprecated set-output GitHub Actions command | Removed deprecated `::set-output` |
| [link-foundation/lino-env](https://github.com/link-foundation/lino-env) | [#25](https://github.com/link-foundation/lino-env/pull/25) | fix(rust): fix manual release workflow_dispatch not running | Fixed job skipping issue |
| [link-foundation/lino-env](https://github.com/link-foundation/lino-env) | [#23](https://github.com/link-foundation/lino-env/pull/23) | feat: add crates.io publishing support to Rust CI/CD workflow | Added crates.io publishing |

## Best Practices Identified

### 1. Remove Deprecated `set-output` Command (PR #27)

**Problem**: The `::set-output` command was deprecated by GitHub in October 2022 and will eventually be disabled.

**Root Cause**: The `setOutput()` function in version-and-commit.mjs was using both:
1. The new `GITHUB_OUTPUT` environment file approach (correct)
2. The deprecated `::set-output` stdout command (causes warnings)

**Solution**: Remove the deprecated `console.log(`::set-output...`)` line and replace with a plain log for visibility.

**References**:
- [GitHub Changelog: Deprecating save-state and set-output commands](https://github.blog/changelog/2022-10-11-github-actions-deprecating-save-state-and-set-output-commands/)
- [GitHub Actions Update on save-state and set-output commands](https://github.blog/changelog/2023-07-24-github-actions-update-on-save-state-and-set-output-commands/)

### 2. Enforce Changelog Fragment Requirement (PR #27, #58)

**Problem**: The changelog fragment check only produced a warning (`::warning::` with `exit 0`) when source code changed without a changelog entry, allowing PRs to pass without proper documentation.

**Root Cause**: Using `exit 0` (success) instead of `exit 1` (failure) in the changelog check.

**Solution**: Change `::warning::` to `::error::` and `exit 0` to `exit 1` to properly fail CI when changelog fragments are missing.

### 3. Fix workflow_dispatch Job Skipping (PR #25)

**Problem**: When triggering the workflow via `workflow_dispatch`, the `detect-changes` job is intentionally skipped. However, jobs with `needs: [detect-changes]` are also skipped due to GitHub Actions' default behavior.

**Root Cause**: When a job dependency is skipped, the dependent job is also skipped - even if its own `if` condition would evaluate to true. This is documented in [GitHub Actions Runner Issue #491](https://github.com/actions/runner/issues/491).

**Solution**: Add `always() && !cancelled()` to job conditions to ensure they run properly when dependencies are skipped, plus explicit checks for `needs.job.result == 'success'`.

**References**:
- [GitHub Actions Runner Issue #491](https://github.com/actions/runner/issues/491)
- [GitHub Actions Runner Issue #2205](https://github.com/actions/runner/issues/2205)
- [GitHub Community Discussion #45058](https://github.com/orgs/community/discussions/45058)

### 4. Add Release Mode Options (PR #25)

**Problem**: The Rust workflow only had one release mode (instant), while the JavaScript workflow had both "instant" and "changelog-pr" modes.

**Solution**: Add `release_mode` workflow input with options:
- `instant` (default): Direct release that goes through lint/test/build verification
- `changelog-pr`: Creates a pull request with a changelog fragment for review

### 5. Add crates.io Publishing Support (PR #23)

**Problem**: The Rust workflow only created GitHub releases but didn't publish to crates.io.

**Solution**: Add crates.io publishing step with:
- `CARGO_TOKEN` secret environment variable for authentication
- "Publish to Crates.io" step in both `auto-release` and `manual-release` jobs
- Graceful handling of "already exists" case to avoid failing when version already published

**Note on Trusted Publishing**: crates.io now supports [Trusted Publishing](https://crates.io/docs/trusted-publishing) which uses OIDC for secure, tokenless publishing. This is the recommended approach for new setups but requires `rust-lang/crates-io-auth-action@v1`.

### 6. Update Release Script for Better Flexibility (PR #23)

**Problem**: The `create-github-release.mjs` script had hardcoded tag prefix and didn't support crates.io links.

**Solution**: Add options to the script:
- `--tag-prefix`: Support different tag formats (e.g., "v" or "rust-v")
- `--crates-io-url`: Include crates.io link in release notes

## Timeline of Events

### October 11, 2022
GitHub announces deprecation of `set-output` and `save-state` commands.

### May 31, 2023
Originally planned disablement date for deprecated commands.

### July 24, 2023
GitHub postpones removal due to significant usage still observed.

### January 2026
Issues identified in link-foundation repositories:
- Issue #26 (lino-env): CI/CD deprecation warnings
- Issue #24 (lino-env): Manual release not working
- Issue #22 (lino-env): Add crates.io publishing
- Issue #57 (start): macOS stdout capture issue (led to discovering changelog check bug)

### January 2026 (PRs Merged)
- PR #23: crates.io publishing support
- PR #25: workflow_dispatch fix
- PR #27: set-output deprecation fix
- PR #58: macOS stdout capture fix + changelog check enforcement

## Files in This Case Study

- [README.md](./README.md) - This overview document
- [analysis-set-output.md](./analysis-set-output.md) - Detailed analysis of set-output deprecation
- [analysis-workflow-dispatch.md](./analysis-workflow-dispatch.md) - Detailed analysis of job skipping issue
- [analysis-crates-io.md](./analysis-crates-io.md) - Detailed analysis of crates.io publishing
- [online-research.md](./online-research.md) - Online research findings

## Changes Applied to This Template

Based on the analysis, the following changes were applied to this repository:

1. **scripts/version-and-commit.mjs**: Removed deprecated `::set-output` command
2. **.github/workflows/release.yml**:
   - Changed changelog check from warning to error (`exit 1`)
   - Added `always() && !cancelled()` to job conditions
   - Added `release_mode` input with "instant" and "changelog-pr" options
   - Added crates.io publishing steps
   - Added `CARGO_TOKEN` environment variable
3. **scripts/create-github-release.mjs**: Added `--tag-prefix` and `--crates-io-url` options

## Key Takeaways

1. **Test failure paths**: CI checks should be tested to ensure they actually fail when they should
2. **Use consistent approaches**: Apply the same patterns across all workflows (JS and Rust)
3. **Verify CI annotations**: Using `::warning::` instead of `::error::` is a hint that the check might not be enforced
4. **Understand GitHub Actions behavior**: The `needs` dependency behavior with skipped jobs is subtle and well-documented
5. **Use `always()` carefully**: Combine with `!cancelled()` and explicit result checks for safety
6. **Stay current with deprecations**: Regularly check for deprecated GitHub Actions commands

## References

### GitHub Documentation
- [Workflow syntax for GitHub Actions](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions)
- [Using jobs in a workflow](https://docs.github.com/actions/using-jobs/using-jobs-in-a-workflow)
- [Using conditions to control job execution](https://docs.github.com/en/actions/using-jobs/using-conditions-to-control-job-execution)

### GitHub Changelog
- [Deprecating save-state and set-output commands](https://github.blog/changelog/2022-10-11-github-actions-deprecating-save-state-and-set-output-commands/)
- [Update on save-state and set-output commands](https://github.blog/changelog/2023-07-24-github-actions-update-on-save-state-and-set-output-commands/)

### GitHub Issues
- [Runner Issue #491: Job-level "if" condition not evaluated correctly](https://github.com/actions/runner/issues/491)
- [Runner Issue #2205: Jobs skipped when NEEDS job ran successfully](https://github.com/actions/runner/issues/2205)

### crates.io
- [Trusted Publishing Documentation](https://crates.io/docs/trusted-publishing)
- [RFC #3691: Trusted Publishing for crates.io](https://rust-lang.github.io/rfcs/3691-trusted-publishing-cratesio.html)
