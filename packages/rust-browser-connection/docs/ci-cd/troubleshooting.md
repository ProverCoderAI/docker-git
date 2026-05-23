# CI/CD Troubleshooting Guide

This guide covers common CI/CD issues and their solutions for Rust projects using this template.

## Table of Contents

1. [Release Jobs Skipped](#release-jobs-skipped)
2. [Version Already Released (False Positive)](#version-already-released-false-positive)
3. [Crates.io Publishing Fails](#cratesio-publishing-fails)
4. [Docker Hub Publishing Fails](#docker-hub-publishing-fails)
5. [Secret Configuration Issues](#secret-configuration-issues)
6. [Multi-Language Repository Issues](#multi-language-repository-issues)

---

## Release Jobs Skipped

### Symptom
Release jobs (auto-release or manual-release) are skipped even though you expected them to run.

### Common Causes

#### 1. Upstream job was skipped
When a job like `detect-changes` is skipped (e.g., on `workflow_dispatch`), all dependent jobs are also skipped by default.

**Solution:** Ensure dependent jobs use `always() && !cancelled()` in their conditions:
```yaml
if: |
  always() && !cancelled() && (
    github.event_name == 'push' ||
    github.event_name == 'workflow_dispatch' ||
    needs.detect-changes.outputs.rs-changed == 'true'
  )
```

#### 2. Build or test failed
Release jobs depend on `build` which depends on `lint` and `test`. If any of these fail, release jobs won't run.

**Solution:** Check the logs for lint, test, and build jobs. Fix any failures before releasing.

#### 3. Wrong trigger condition
The job condition may not match your trigger event.

**Solution:** Verify the job's `if` condition matches your trigger:
- `github.event_name == 'push'` for automatic releases on merge
- `github.event_name == 'workflow_dispatch'` for manual triggers

### Reference
- [GitHub Actions Runner Issue #491](https://github.com/actions/runner/issues/491)

---

## Version Already Released (False Positive)

### Symptom
The release workflow says "version already released" but the package is not actually on crates.io.

### Root Cause
The workflow was checking git tags instead of crates.io. Git tags can exist without the package being published (e.g., from previous GitHub-only releases).

### Solution
This template now checks crates.io directly using the API:
```javascript
const response = await fetch(
  `https://crates.io/api/v1/crates/${crateName}/${version}`
);
const isPublished = response.ok && (await response.json()).version;
```

### Verification
Check if your package exists on crates.io:
```bash
curl -s "https://crates.io/api/v1/crates/YOUR_CRATE_NAME" | jq
```

### Reference
- [browser-commander Issue #29](https://github.com/link-foundation/browser-commander/issues/29)

---

## Crates.io Publishing Fails

### Symptom
The "Publish to Crates.io" step fails with an error.

### Common Errors

#### "please provide a non-empty token"
**Cause:** The `CARGO_REGISTRY_TOKEN` environment variable is empty or not set.

**Solution:**
1. Ensure you have a secret configured (either `CARGO_REGISTRY_TOKEN` or `CARGO_TOKEN`)
2. Map the secret correctly in your workflow:
```yaml
- name: Publish to Crates.io
  env:
    CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
  run: node scripts/publish-crate.mjs
```

#### "already uploaded" or "already exists"
**Cause:** This version was already published to crates.io.

**Note:** This is handled gracefully by the script and is not a failure.

#### "unauthorized" or authentication errors
**Cause:** Invalid or expired token.

**Solution:**
1. Generate a new token at https://crates.io/settings/tokens
2. Update the secret in your repository or organization settings

### Reference
- [browser-commander Issue #33](https://github.com/link-foundation/browser-commander/issues/33)
- [Cargo Publishing Documentation](https://doc.rust-lang.org/cargo/reference/publishing.html)

---

## Docker Hub Publishing Fails

### Symptom
The crates.io publish succeeds, but the release workflow fails before or during Docker Hub publishing.

### Required Configuration

Docker Hub publishing is optional. It runs only when all of these are true:

- A root `Dockerfile` exists
- Repository variable `DOCKERHUB_IMAGE` is set to `namespace/repository`
- `DOCKERHUB_USERNAME` is set as a repository variable or secret
- Repository secret `DOCKERHUB_TOKEN` is set

### Common Errors

#### "Docker Hub publishing requires DOCKERHUB_USERNAME and DOCKERHUB_TOKEN"
**Cause:** `DOCKERHUB_IMAGE` and `Dockerfile` enabled Docker publishing, but credentials are incomplete.

**Solution:** Set `DOCKERHUB_USERNAME` and create a Docker Hub access token stored as `DOCKERHUB_TOKEN`.

#### Docker tag is missing after crates.io already published
**Cause:** A previous release run published the crate, then failed before Docker Hub or GitHub Release completed.

**Solution:** Re-run the release workflow after fixing the Docker Hub configuration. The release check treats the version as incomplete and recreates missing artifacts without bumping the Cargo version again.

### Verification
Check whether a Docker Hub tag exists:

```bash
curl -fsSL "https://hub.docker.com/v2/repositories/NAMESPACE/REPOSITORY/tags/VERSION"
```

### Reference
- [Docker GitHub Actions guide](https://docs.docker.com/build/ci/github-actions/)

---

## Secret Configuration Issues

### Required Secrets

| Secret Name | Purpose | Where to Get |
|------------|---------|--------------|
| `CARGO_REGISTRY_TOKEN` or `CARGO_TOKEN` | Publish to crates.io | https://crates.io/settings/tokens |
| `DOCKERHUB_TOKEN` | Publish to Docker Hub when `DOCKERHUB_IMAGE` is configured | https://app.docker.com/settings/personal-access-tokens |
| `GITHUB_TOKEN` | Create GitHub releases | Automatic (provided by GitHub) |

### Organization vs Repository Secrets

If using organization secrets with different names, map them in your workflow:
```yaml
env:
  # Map organization secret to the expected variable name
  CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
```

### Checking Secret Values

Secrets are masked in logs, but you can verify they're set:
```yaml
- name: Debug secrets
  run: |
    if [ -n "$CARGO_REGISTRY_TOKEN" ]; then
      echo "CARGO_REGISTRY_TOKEN is set (value masked)"
    else
      echo "WARNING: CARGO_REGISTRY_TOKEN is NOT set"
    fi
  env:
    CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
```

### Reference
- [GitHub Actions Secrets Documentation](https://docs.github.com/actions/security-guides/using-secrets-in-github-actions)

---

## Multi-Language Repository Issues

### Symptom
Scripts fail to find `Cargo.toml` or run in the wrong directory.

### Solution
This template auto-detects the repository structure:
- **Single-language:** `Cargo.toml` in repository root
- **Multi-language:** `Cargo.toml` in `rust/` subfolder

If auto-detection fails, you can explicitly configure the Rust root:
```bash
# Via environment variable
RUST_ROOT=rust node scripts/publish-crate.mjs

# Via CLI argument
node scripts/publish-crate.mjs --rust-root rust
```

### Workflow Configuration
For multi-language repos, ensure your workflow has the correct `working-directory`:
```yaml
defaults:
  run:
    working-directory: rust

steps:
  - name: Publish to Crates.io
    working-directory: .  # Override for scripts that handle paths themselves
    run: node rust/scripts/publish-crate.mjs
```

### Reference
- [browser-commander Issue #31](https://github.com/link-foundation/browser-commander/issues/31)

---

## General Debugging Tips

### 1. Check Job Dependencies
View the workflow graph in GitHub Actions to see which jobs depend on which.

### 2. Download Full Logs
```bash
gh run view <run-id> --repo owner/repo --log > ci-logs.txt
```

### 3. Enable Debug Logging
Add this secret to enable debug logging:
- Name: `ACTIONS_STEP_DEBUG`
- Value: `true`

### 4. Check crates.io Status
Sometimes crates.io has issues. Check: https://status.crates.io/

### 5. Verify Package Locally
Before pushing, verify your package builds and passes checks:
```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
cargo test --all-features
cargo package --list
```
