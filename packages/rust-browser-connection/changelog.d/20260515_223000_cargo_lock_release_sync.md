---
bump: patch
---

### Fixed
- Release automation now keeps the workspace package entry in `Cargo.lock` synchronized when `scripts/version-and-commit.rs` bumps `Cargo.toml`, preventing stale lock-file version diffs in later pull requests.
