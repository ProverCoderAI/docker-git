# Issue 38 Case Study: Decouple Documentation Deployment From Package Release Publication

## Summary

Issue [#38](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/38) reported that Rust API documentation deployment was coupled to package release publication in `.github/workflows/release.yml`. A failed package or GitHub release caused `deploy-docs` to be skipped, even when the package build had already succeeded and documentation could still be generated.

The fix changes `deploy-docs` to depend on `build`, gates it on `needs.build.result == 'success'`, and preserves the existing trigger intent: deploy docs on `main` pushes and manual `workflow_dispatch` runs with `release_mode == 'instant'`. The fix also cleans up release-script warning failures that were blocking the observed release path under `RUSTFLAGS=-Dwarnings`.

## Collected Data

Raw GitHub and template comparison data is stored in this directory:

- `raw-data/issue-38.json` and `raw-data/issue-38-comments.json`: issue details and the latest issue comments.
- `raw-data/pr-39.json`, `raw-data/pr-39-conversation-comments.json`, `raw-data/pr-39-review-comments.json`, and `raw-data/pr-39-reviews.json`: prepared PR data.
- `raw-data/main-run-24465255225.json` and `raw-data/main-run-24465255225.log.gz`: Rust template `main` release run that reproduced the issue.
- `raw-data/downstream-meta-before-run-24983875003.json` and `.log.gz`: downstream `meta-ontology` run before the same fix.
- `raw-data/downstream-meta-after-run-24985948212.json` and `.log.gz`: downstream `meta-ontology` run after the same fix.
- `raw-data/pr-run-25212295127.json` and `.log.gz`: initial PR branch CI run.
- `raw-data/js-template-issue-search.json` and `raw-data/rust-template-issue-search.json`: search results for matching template issues.
- `template-data/rust-template-release-before.yml` and `template-data/rust-template-release-after.yml`: before/after workflow snapshots.
- `template-data/js-template-release.yml`, `template-data/js-template-links.yml`, and template tree files: JavaScript template comparison inputs.

The downloaded CI logs have more than 1500 lines, so the analysis references narrow uncompressed line ranges instead of embedding full logs.

## Timeline

- 2026-04-15 16:12:07 UTC: Rust template `main` release run `24465255225` started at commit `353d893ba0a26ecec6fb1ba1716b6a9ad27e1fef`.
- 2026-04-15 16:13:54 to 16:14:09 UTC: `Build Package` succeeded in run `24465255225`.
- 2026-04-15 16:14:11 to 16:15:21 UTC: `Auto Release` failed in run `24465255225`.
- 2026-04-15 16:15:22 UTC: `Deploy Rust Documentation` was skipped in run `24465255225`, even though `Build Package` succeeded.
- 2026-04-27 08:11:01 UTC: downstream `meta-ontology` run `24983875003` reproduced the same pattern: build succeeded, auto release failed, docs deploy skipped.
- 2026-04-27 08:59:30 UTC: downstream `meta-ontology` run `24985948212`, after applying the same workflow dependency fix, showed `Auto Release` failing while `Deploy Rust Documentation` succeeded.
- 2026-05-01 11:11:28 UTC: the Rust template issue was updated with a broader request to compare Rust and JavaScript templates, preserve evidence, and document the analysis.
- 2026-05-01 11:12:08 UTC: PR [#39](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/pull/39) was created from `issue-38-325a287cfa55`.

## Requirements

The issue and follow-up comment required:

- Decouple documentation deployment from package release publication.
- Keep docs deployment limited to successful builds.
- Preserve the intended release triggers: `main` push and manual instant workflow dispatch.
- Investigate historical CI logs and related downstream work.
- Compare the Rust and JavaScript pipeline templates.
- File or identify related template issues if the same bug exists elsewhere.
- Add a reproducing automated test before the fix.
- Store research and data under `docs/case-studies/issue-38`.

## Root Cause

The workflow-level cause was:

```yaml
deploy-docs:
  needs: [auto-release, manual-release]
```

Because `deploy-docs` depended on release publication jobs, it was downstream of both release success and release failure. The old `if` condition only allowed docs deployment when either release job succeeded. In the observed `main` run, `auto-release` failed and `manual-release` was skipped, so `deploy-docs` was skipped.

GitHub Actions documentation confirms the dependency behavior: jobs declared in `needs` wait for those jobs, and failed or skipped dependencies skip downstream jobs unless a job-level condition explicitly changes that behavior. The `needs` context exposes each direct dependency result as `success`, `failure`, `cancelled`, or `skipped`. GitHub also recommends `!cancelled()` for jobs that should continue after non-critical failures without running after cancellation.

The release-path failure was separate but relevant. In run `24465255225`, the `Auto Release` job failed while running `rust-script scripts/check-release-needed.rs` under `RUSTFLAGS=-Dwarnings`. The downloaded log shows:

- `raw-data/main-run-24465255225.log.gz`, uncompressed lines 4798-4809: `check-release-needed.rs` was invoked with `HAS_FRAGMENTS=true` and `RUSTFLAGS=-Dwarnings`.
- Lines 4810-4817: `get_arg` in `scripts/check-release-needed.rs` failed as dead code.
- Lines 4819-4854: shared helper functions in `scripts/rust-paths.rs` also failed as dead code when the file was imported as a module.
- Lines 4855-4857: the script compile failed and the job exited with code 1.

The downstream `meta-ontology` before-fix run `24983875003` showed the same warnings-as-errors pattern in uncompressed lines 5699-5758.

## Solution

The workflow fix makes documentation depend only on the successful build artifact boundary:

```yaml
deploy-docs:
  needs: [build]
  if: |
    !cancelled() &&
    needs.build.result == 'success' && (
      (github.event_name == 'push' && github.ref == 'refs/heads/main') ||
      (github.event_name == 'workflow_dispatch' && github.event.inputs.release_mode == 'instant')
    )
```

This keeps documentation independent from package publication while still requiring a known-good build. It also avoids using `always()` for the docs job, so cancellation still stops the workflow.

The script cleanup removes the unused `get_arg` helper from `check-release-needed.rs` and marks `rust-paths.rs` as an importable script utility with `#![allow(dead_code)]`. That resolves the concrete `RUSTFLAGS=-Dwarnings` failure observed in CI without weakening the rest of the repository lint settings.

## Regression Test

`tests/unit/ci-cd/workflow_release.rs` reproduces the workflow bug structurally. It extracts the `deploy-docs` job block from `.github/workflows/release.yml` and asserts that:

- `deploy-docs` depends on `build`.
- the condition checks `needs.build.result == 'success'`.
- the condition still limits push deployments to `refs/heads/main`.
- the job no longer depends on `auto-release` or `manual-release` results.

Before the workflow change, this test failed on `deploy_docs.contains("needs: [build]")`. After the fix, it passes.

## Template Comparison

Rust template:

- Before fix: `template-data/rust-template-release-before.yml` used `cancel-in-progress: true` and `deploy-docs.needs: [auto-release, manual-release]`.
- After fix: `template-data/rust-template-release-after.yml` uses `cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}` and `deploy-docs.needs: [build]`.
- Search results in `raw-data/rust-template-issue-search.json` found the existing tracked issue: #38. No additional Rust template issue is needed.

JavaScript template:

- `template-data/js-template-release.yml` has no documentation deployment job and no GitHub Pages publication job, so the exact docs-release coupling bug does not exist there.
- The JavaScript template already uses `cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}`, which avoids cancelling in-progress PR checks while keeping stale `main` release runs under control.
- The JavaScript template has a `validate-docs` job for documentation-only validation, but that is a validation concern rather than a deployment concern.
- Search results in `raw-data/js-template-issue-search.json` found no matching issue to file or update.

## Online Research

Official GitHub documentation used for the workflow reasoning:

- [Workflow syntax: `jobs.<job_id>.needs`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds)
- [Contexts reference: `needs` context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#needs-context)
- [Expressions: status check functions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions)
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [actions/deploy-pages README](https://github.com/actions/deploy-pages)

GitHub Pages documentation and `actions/deploy-pages` both describe the build-then-deploy shape for Pages deployments. This PR does not migrate from `peaceiris/actions-gh-pages@v4` to `actions/deploy-pages`, because that would be a broader repository settings and permissions change. The narrow fix is to correct this workflow's dependency graph.

## Verification

Local checks run on 2026-05-01:

- `cargo test --test unit ci_cd::workflow_release::documentation_deploy_is_independent_from_release_publication`
- `RUSTFLAGS=-Dwarnings HAS_FRAGMENTS=true rust-script scripts/check-release-needed.rs`
- `cargo fmt --all -- --check`
- `cargo test --all-features --verbose`
- `cargo test --doc --verbose`
- `cargo clippy --all-targets --all-features`
- `rust-script scripts/check-file-size.rs`
- `cargo build --release --verbose`
- `cargo package --list --allow-dirty`

The downstream after-fix run `24985948212` provides live workflow evidence that the dependency shape works: `Build Package` succeeded, `Auto Release` failed, and `Deploy Rust Documentation` still succeeded. The deploy job built docs at uncompressed lines 5801-5802 and completed `peaceiris/actions-gh-pages@v4` successfully at lines 6074-6082.
