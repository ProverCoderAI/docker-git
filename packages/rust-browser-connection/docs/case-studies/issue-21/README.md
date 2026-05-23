# Case Study: Issue #21 - Integrate Best Practices to Prevent Repeating CI/CD Issues

## Summary

This case study analyzes a series of CI/CD failures in the `browser-commander` repository (issues #27, #29, #31, #33) and identifies best practices that should be integrated into the `rust-ai-driven-development-pipeline-template` to prevent similar issues from occurring in derived repositories.

## Timeline of Events

| Date | Issue/PR | Problem | Resolution |
|------|----------|---------|------------|
| 2026-01-16 17:09 | Issue #27 | Rust release jobs skipped on workflow_dispatch | Added `always() && !cancelled()` to job conditions |
| 2026-01-17 09:45 | Issue #29 | False positive version check (git tags vs crates.io) | Changed to check crates.io API instead of git tags |
| 2026-01-18 01:16 | Issue #31 | Missing `cargo publish` step in workflow | Added `publish-crate.mjs` script and workflow step |
| 2026-01-18 17:53 | Issue #33 | Secret name mismatch (CARGO_REGISTRY_TOKEN vs CARGO_TOKEN) | Map org secret to standard env var |

### Detailed Sequence

#### Issue #27: Release Jobs Skipped (2026-01-16)

**Root Cause:** When `detect-changes` job is skipped (on `workflow_dispatch`), all dependent jobs are also skipped by default unless they use `always()` in their condition.

**Chain Reaction:**
1. On `workflow_dispatch`, `detect-changes` is skipped (by design)
2. Without `always()`, `lint` job is automatically skipped when its dependency is skipped
3. `build` depends on `lint`, so it's also skipped
4. `manual-release` depends on `build`, so it's also skipped

**Fix:** Add `always() && !cancelled()` to all dependent job conditions:
```yaml
if: |
  always() && !cancelled() && (
    github.event_name == 'push' ||
    github.event_name == 'workflow_dispatch' ||
    ...
  )
```

#### Issue #29: False Positive Version Check (2026-01-17)

**Root Cause:** The workflow checked if a git tag exists to determine if a version was "already released":
```bash
if git rev-parse "v$CURRENT_VERSION" >/dev/null 2>&1; then
    echo "... already released"
fi
```

This caused false positives because git tags can exist without the package being published to crates.io.

**Evidence:**
- `browser-commander` had 10 GitHub releases (v0.1.1 through v0.5.4)
- But **NONE** of them existed on crates.io
- The workflow incorrectly marked versions as "already released"

**Fix:** Check crates.io API directly:
```bash
CRATES_IO_RESPONSE=$(curl -s "https://crates.io/api/v1/crates/${CRATE_NAME}/${CURRENT_VERSION}")
if echo "$CRATES_IO_RESPONSE" | grep -q '"version"'; then
    VERSION_ON_CRATES_IO=true
fi
```

#### Issue #31: Missing Cargo Publish Step (2026-01-18 01:16)

**Root Cause:** The workflow correctly detected that versions weren't published to crates.io, but lacked the actual `cargo publish` step.

The workflow only:
1. Built the release binary (`cargo build --release`)
2. Created a GitHub release

**Missing step:** Actual `cargo publish` to publish to crates.io.

**Fix:** Add `publish-crate.mjs` script and workflow step:
```yaml
- name: Publish to Crates.io
  if: steps.check.outputs.should_release == 'true'
  env:
    CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
  run: node scripts/publish-crate.mjs
```

#### Issue #33: Secret Name Mismatch (2026-01-18 17:53)

**Root Cause:** The workflow referenced `secrets.CARGO_REGISTRY_TOKEN` but the organization secret was named `CARGO_TOKEN`.

**CI Log Evidence:**
```
CARGO_REGISTRY_TOKEN:
##[warning]Neither CARGO_REGISTRY_TOKEN nor CARGO_TOKEN is set
error: please provide a non-empty token
```

**Fix:** Map the organization secret to the expected environment variable:
```yaml
env:
  CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
```

## Root Causes Summary

### 1. GitHub Actions Job Dependency Behavior

**Problem:** When a job is skipped, all dependent jobs are also skipped unless they use `always()`.

**Best Practice:** Always use `always() && !cancelled()` in job conditions when depending on jobs that may be skipped:
```yaml
if: always() && !cancelled() && needs.build.result == 'success'
```

### 2. Version Check Logic

**Problem:** Checking git tags is not sufficient to determine if a version is published.

**Best Practice:** Check the actual package registry (crates.io for Rust, npm for JS, PyPI for Python):
```javascript
// Example: Check crates.io API
const response = await fetch(`https://crates.io/api/v1/crates/${crateName}/${version}`);
const isPublished = response.ok && (await response.json()).version;
```

### 3. Missing Publication Steps

**Problem:** Building and creating GitHub releases doesn't mean the package is published to the registry.

**Best Practice:** Always include the publication step:
- Rust: `cargo publish`
- JavaScript: `npm publish`
- Python: `twine upload`

### 4. Environment Variable Naming Conventions

**Problem:** Different naming conventions between organization secrets and what tools expect.

**Best Practice:** Document and standardize secret names. Use mapping when necessary:
```yaml
env:
  CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}
```

## Template vs Browser-Commander Comparison

### Files Present in Template but Missing in Browser-Commander

| Template File | Purpose | Browser-Commander Status |
|---------------|---------|-------------------------|
| `scripts/check-release-needed.mjs` | Checks crates.io for version status | Present (in rust/scripts/) |
| `scripts/git-config.mjs` | Configures git for automated commits | Missing (uses inline script) |
| `scripts/check-changelog-fragment.mjs` | Validates changelog fragments | Missing (uses inline script) |
| `scripts/check-version-modification.mjs` | Prevents manual version changes | Missing |
| `scripts/create-changelog-fragment.mjs` | Creates changelog fragment from workflow | Missing |
| `.pre-commit-config.yaml` | Pre-commit hooks | Missing |
| `CONTRIBUTING.md` | Contributing guidelines | Missing |
| `changelog.d/README.md` | Changelog fragment documentation | Present |

### Workflow Differences

| Feature | Template | Browser-Commander |
|---------|----------|-------------------|
| Secret handling | `CARGO_REGISTRY_TOKEN \|\| CARGO_TOKEN` | `CARGO_TOKEN` mapped to `CARGO_REGISTRY_TOKEN` |
| Version check | External script with crates.io check | Inline script with crates.io check |
| Git config | External script | Inline commands |
| Changelog check | External script | Inline script |
| Version modification check | Present | Missing |
| Release modes | instant + changelog-pr | Single mode |

## Recommendations for Template Improvements

### 1. Robust Secret Handling (Priority: High)

Add fallback support for multiple secret naming conventions:
```yaml
env:
  CARGO_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}
```

This is already implemented in the template.

### 2. Comprehensive Documentation (Priority: High)

Add a "CI/CD Troubleshooting Guide" in the template that covers:
- Common failure modes (jobs skipped, secret issues, version check failures)
- How to verify crates.io publication status
- How to manually trigger releases
- Secret setup requirements

### 3. Multi-Language Repository Support (Priority: Medium)

The `rust-paths.mjs` module in browser-commander provides excellent support for both:
- Single-language repos (Cargo.toml at root)
- Multi-language repos (rust/Cargo.toml)

This should be incorporated into the template.

### 4. Enhanced Error Reporting (Priority: Medium)

The `publish-crate.mjs` script should:
- Fail explicitly when authentication fails
- Provide clear error messages about which secret is expected
- Log the masked token presence for debugging

### 5. Job Result Verification (Priority: High)

All release jobs should verify that upstream jobs succeeded:
```yaml
if: |
  always() && !cancelled() &&
  needs.lint.result == 'success' &&
  needs.test.result == 'success' &&
  needs.build.result == 'success'
```

## Files in This Case Study

- `README.md` - This analysis document
- `browser-commander-issue-27.md` - Case study from issue #27 (jobs skipped)
- `browser-commander-issue-29.md` - Case study from issue #29 (false positive version check)
- `browser-commander-issue-31.md` - Case study from issue #31 (missing publish step)
- `browser-commander-issue-33.md` - Case study from issue #33 (secret name mismatch)
- `browser-commander-rust.yml` - Browser-commander's Rust CI/CD workflow (reference)

## References

- Issue #21: https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/21
- Browser-Commander PRs: #28, #30, #32, #34
- GitHub Actions Runner Issue #491: https://github.com/actions/runner/issues/491
- Cargo Registry Documentation: https://doc.rust-lang.org/cargo/reference/registries.html
- Template Repository: https://github.com/link-foundation/rust-ai-driven-development-pipeline-template

## Lessons Learned

1. **Test the complete pipeline end-to-end** - Don't just test individual steps; verify that packages actually appear on the registry.

2. **Document secret naming conventions** - Clearly document which secrets are needed and their exact names.

3. **Use defensive coding in workflows** - Always handle the case where dependencies are skipped using `always() && !cancelled()`.

4. **Check the source of truth** - For package publication, check the actual registry (crates.io), not proxies like git tags.

5. **Provide clear error messages** - When authentication fails, make it obvious which secret is missing or misconfigured.

6. **Keep templates synchronized** - Regularly audit derived repositories against the template to catch missing features or fixes.
