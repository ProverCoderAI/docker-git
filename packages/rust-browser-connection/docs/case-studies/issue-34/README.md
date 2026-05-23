# Case Study: Issue #34 — detect-code-changes Uses Full PR Diff Instead of Per-Commit Diff

## Summary

The `detect-code-changes.rs` script compared the full PR diff (base SHA to head SHA) instead of evaluating each commit individually. This caused a commit that only modified non-code files (e.g., `.gitkeep`, `README.md`) to trigger all CI jobs if any earlier commit in the same PR touched code files.

## Timeline of Events

1. **Origin**: The issue was first observed in [link-assistant/web-capture PR #49](https://github.com/link-assistant/web-capture/pull/49), where commit `0e9b6e8c` only modified `.gitkeep` but triggered all 8 CI jobs because the PR as a whole contained code changes.

2. **Root cause identified**: GitHub Actions checks out a **synthetic merge commit** for `pull_request` events:
   - `HEAD` = synthetic merge commit
   - `HEAD^` = base branch (first parent)
   - `HEAD^2` = actual PR head commit (second parent)

   Using `git diff HEAD^ HEAD` or `git diff base_sha head_sha` gives the **full PR diff**, not the per-commit diff. This is the same fundamental problem as GitHub Actions' `paths:` filters.

3. **Fix developed and verified**: The fix was first implemented and CI-verified in [link-assistant/web-capture PR #51](https://github.com/link-assistant/web-capture/pull/51) using a JavaScript implementation (`detect-code-changes.mjs`).

4. **Cross-repo filing**: The same issue was filed on both template repos:
   - Rust template: [link-foundation/rust-ai-driven-development-pipeline-template#34](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/34)
   - JS template: [link-foundation/js-ai-driven-development-pipeline-template#31](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/31)

## Root Cause Analysis

### Problem: Full PR Diff Instead of Per-Commit Diff

**Root cause**: The `get_changed_files()` function in `detect-code-changes.rs` used `GITHUB_BASE_SHA` and `GITHUB_HEAD_SHA` environment variables to compute `git diff base_sha head_sha`, which returns all files changed across the entire PR — not just the latest commit.

**Before (broken)**:
```rust
if event_name == "pull_request" {
    let base_sha = env::var("GITHUB_BASE_SHA").ok();
    let head_sha = env::var("GITHUB_HEAD_SHA").ok();
    if let (Some(base), Some(head)) = (base_sha, head_sha) {
        exec_silent("git", &["fetch", "origin", &base]);
        let output = exec("git", &["diff", "--name-only", &base, &head]);
        // This returns ALL files changed in the PR, not just the latest commit
    }
}
```

**Why `HEAD^..HEAD` also doesn't work for PRs**: GitHub Actions creates a synthetic merge commit for `pull_request` events. `HEAD^` is the base branch (first parent), so `git diff HEAD^ HEAD` also gives the full PR diff — the exact same problem.

**After (fixed)**:
```rust
fn is_merge_commit() -> bool {
    let output = exec("git", &["cat-file", "-p", "HEAD"]);
    output.lines().filter(|line| line.starts_with("parent ")).count() > 1
}

fn get_changed_files() -> Vec<String> {
    if is_merge_commit() {
        // HEAD^2 = actual PR head, HEAD^2^ = its parent
        // This gives the per-commit diff of the latest push
        let output = exec("git", &["diff", "--name-only", "HEAD^2^", "HEAD^2"]);
        // ...
    }
    // For push events: HEAD^ to HEAD (regular per-commit diff)
}
```

**Key insight**: `HEAD^2` is the actual PR head commit (second parent of the merge commit). `HEAD^2^` is its parent. So `git diff HEAD^2^ HEAD^2` gives exactly the per-commit diff of the latest push to the PR.

### Workflow Change

The `GITHUB_BASE_SHA` and `GITHUB_HEAD_SHA` environment variables were removed from the workflow's detect-changes step since they are no longer needed — the script now uses git's commit graph directly.

## Requirements from Issue

| # | Requirement | Status |
|---|---|---|
| 1 | Use per-commit diff instead of full PR diff for change detection | Done |
| 2 | Handle GitHub Actions synthetic merge commit correctly | Done |
| 3 | Follow best practices from web-capture PR #51 | Done |
| 4 | Create case study with root cause analysis | Done |
| 5 | Create experiment scripts for testing | Done |

## Possible Solutions Considered

| Solution | Pros | Cons | Chosen? |
|---|---|---|---|
| Merge commit detection (`HEAD^2^..HEAD^2`) | Accurate per-commit diff; works without env vars; proven in web-capture CI | Requires understanding of git merge commit structure | Yes |
| Use `GITHUB_BASE_SHA`/`GITHUB_HEAD_SHA` with commit limiting | Uses official GitHub API values | Still gives full PR diff; doesn't solve the core problem | No |
| GitHub Actions `paths:` filters | Built-in, no script needed | Evaluates full PR diff; same fundamental problem | No |

## CI Verification

The fix was verified in CI run [#24394764654](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/actions/runs/24394764654). The last commit (removing `.gitkeep`) correctly triggered only the per-commit diff:

```
Merge commit detected (pull_request event)
Comparing HEAD^2^ to HEAD^2 (per-commit diff of PR head)
Changed files:
  .gitkeep
rs-changed=false
toml-changed=false
any-code-changed=false
```

As a result, Lint, Code Coverage, and Changelog Fragment Check were all correctly **skipped** — they would have been triggered under the old full-PR-diff behavior because earlier commits in the PR modified `.rs` and `.yml` files.

## Additional Context: GitHub Actions Merge Commit Behavior

GitHub Actions creates two special refs for every pull request:
- `refs/pull/NUMBER/head` — the HEAD of the PR branch
- `refs/pull/NUMBER/merge` — a synthetic merge commit previewing the merge into the target branch

When using the `pull_request` trigger, `@actions/checkout` checks out `refs/pull/NUMBER/merge` (the synthetic merge commit). This means:
- `HEAD` is the merge commit (has 2 parents)
- `HEAD^` (first parent) is the base branch tip
- `HEAD^2` (second parent) is the actual PR head commit

This is documented in the [GitHub community discussion on base.sha behavior](https://github.com/orgs/community/discussions/59677) and the [Frontside deep dive into pull_request](https://frontside.com/blog/2020-05-26-github-actions-pull_request/). The [actions/checkout issue #426](https://github.com/actions/checkout/issues/426) also discusses the distinction between checking out the merge commit vs the HEAD commit.

## References

- [link-assistant/web-capture#50](https://github.com/link-assistant/web-capture/issues/50) — Original issue
- [link-assistant/web-capture#51](https://github.com/link-assistant/web-capture/pull/51) — Reference implementation (JS)
- [link-foundation/js-ai-driven-development-pipeline-template#31](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/31) — Same issue on JS template
- [GitHub Actions: Events that trigger workflows](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#pull_request) — Documentation on synthetic merge commits
- [GitHub community discussion: base.sha update behavior](https://github.com/orgs/community/discussions/59677) — Explains how `github.event.pull_request.base.sha` works
- [Frontside: GitHub Actions pull_request deep dive](https://frontside.com/blog/2020-05-26-github-actions-pull_request/) — Explains synthetic merge commit structure
- [actions/checkout#426: Merge commit vs HEAD commit](https://github.com/actions/checkout/issues/426) — Discussion on checkout behavior for PRs
