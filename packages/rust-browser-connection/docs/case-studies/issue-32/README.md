# Case Study: Issue #32 — Publish Steps Override Workflow-Level CARGO_TOKEN Fallback

## Summary

The CI/CD pipeline's publish steps used a step-level `env` block that overrode the workflow-level `CARGO_TOKEN` fallback chain, breaking repositories that only configure `CARGO_REGISTRY_TOKEN` as a secret. Additionally, the `version-and-commit.rs` script lacked push retry logic, causing failures in multi-workflow repositories with concurrent release jobs.

## Timeline of Events

1. **Origin**: The issue was first observed in [link-assistant/web-capture#46](https://github.com/link-assistant/web-capture/issues/46), where `CARGO_REGISTRY_TOKEN` was not set in the publish step, causing the publish to skip silently.

2. **Discovery**: Investigation revealed that the workflow-level `env` block correctly defined a fallback chain (`${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`), but the per-step `env` blocks in both `auto-release` and `manual-release` jobs overrode this with only `${{ secrets.CARGO_TOKEN }}`, which would be empty if only `CARGO_REGISTRY_TOKEN` was configured.

3. **Related issue #31**: In [link-assistant/agent](https://github.com/link-assistant/agent), the Rust auto-release job failed with `non-fast-forward` errors when a JS release job pushed to `main` first. The `version-and-commit.rs` script did a single `git push` with no retry or rebase logic.

4. **Scope expansion**: Comparison with reference repos (browser-commander, lino-arguments, trees-rs, Numbers) revealed additional gaps in mono-repo path support across several scripts.

## Root Cause Analysis

### Problem 1: CARGO_TOKEN Fallback (Issue #32)

**Root cause**: GitHub Actions step-level `env` blocks override workflow-level `env` for the same variable name. The publish steps set:

```yaml
env:
  CARGO_TOKEN: ${{ secrets.CARGO_TOKEN }}
```

This overrides the workflow-level `CARGO_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`, making `CARGO_TOKEN` empty when only `CARGO_REGISTRY_TOKEN` is configured as a repository secret.

**Mitigating factor**: The `publish-crate.rs` script checks both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables (in that order), so publishing still worked because `CARGO_REGISTRY_TOKEN` was inherited from the workflow-level env. However, this was fragile and misleading.

**Fix**: Set both `CARGO_REGISTRY_TOKEN` (with fallback) and `CARGO_TOKEN` at both workflow and step levels:

```yaml
env:
  CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}
  CARGO_TOKEN: ${{ secrets.CARGO_TOKEN }}
```

### Problem 2: Non-Fast-Forward Push (Issue #31)

**Root cause**: The `version-and-commit.rs` script performed a single `git push` without first rebasing on the remote branch. In multi-workflow repositories where multiple release jobs can push to `main` concurrently, the first push succeeds but subsequent pushes fail with `non-fast-forward` errors.

**Fix**: Added pre-commit `git fetch` + `rebase` and post-commit push retry (3 attempts) with `git pull --rebase` between failures.

### Problem 3: Inconsistent Mono-Repo Support

**Root cause**: Several scripts (`check-changelog-fragment.rs`, `check-version-modification.rs`, `create-changelog-fragment.rs`) hardcoded paths like `Cargo.toml`, `changelog.d/`, `src/`, `tests/` without considering the `rust/` subdirectory prefix used in multi-language repositories.

**Fix**: Added `get_rust_root()` detection (checks `RUST_ROOT` env var, then auto-detects `./Cargo.toml` vs `./rust/Cargo.toml`) to all affected scripts.

## Requirements from Issue

| # | Requirement | Status |
|---|---|---|
| 1 | Fix CARGO_TOKEN fallback in publish steps | Done |
| 2 | Support CARGO_REGISTRY_TOKEN-only configurations | Done |
| 3 | Fix non-fast-forward push in multi-workflow repos (#31) | Done |
| 4 | Compare CI/CD with reference repos for best practices | Done |
| 5 | Ensure mono-repo support across all scripts | Done |
| 6 | Add `!cancelled()` guard to test job | Done |
| 7 | Create case study documentation | Done |

## Affected Repositories

The same CARGO_TOKEN fallback issue exists in:
- `link-foundation/browser-commander` (`.github/workflows/rust.yml`)
- `link-foundation/lino-arguments` (`.github/workflows/rust.yml`)
- `linksplatform/Numbers` (`.github/workflows/rust.yml`)

Since these are derived from this template, fixing it here allows downstream repos to adopt the fix.

## Reference Comparison Results

A full comparison of CI/CD files was performed against 4 reference repos. Key findings:

### Our template is ahead of all references in:
- Push retry logic (3 attempts with pull-rebase)
- Pre-commit fetch/rebase for concurrent workflows
- Dual CARGO_REGISTRY_TOKEN + CARGO_TOKEN env setup
- Code coverage with cargo-llvm-cov + Codecov
- Automated badges in GitHub release notes
- Template-aware skips (example-sum-package-name guard)
- Configurable tag prefix and release label
- Updated GitHub Actions versions (v5/v6/v8)
- `--all-features` in cargo doc

### Adopted from references:
- `!cancelled()` guard in test job condition (from lino-arguments, browser-commander)

## Files Changed

- `.github/workflows/release.yml` — CARGO_REGISTRY_TOKEN fallback, `!cancelled()` guard
- `scripts/version-and-commit.rs` — fetch/rebase + push retry logic
- `scripts/check-changelog-fragment.rs` — mono-repo path support
- `scripts/check-version-modification.rs` — mono-repo path support
- `scripts/create-changelog-fragment.rs` — mono-repo path support
