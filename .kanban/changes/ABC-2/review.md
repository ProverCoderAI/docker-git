# ABC-2 Review Notes

## Issue Alignment

The implementation matches issue #138 by keeping a single shared bare mirror per repository URL and using that mirror for warm clone data. The generated runtime still refreshes the mirror from the authenticated remote first, which preserves access checks and remote freshness.

## Risk Review

### P1: Invalid Mirror HEAD

Risk:

An `issue-*` fallback clone can create a local branch and bootstrap the bare mirror with `HEAD` pointing at that local-only branch. A later mirror refresh can prune that ref, after which cloning directly from the mirror can produce an unborn or empty checkout.

Resolution:

The entrypoint now computes `CACHE_HEAD_REF`, verifies it exists with:

```bash
git --git-dir "$CACHE_REPO_DIR" show-ref --verify --quiet "$CACHE_HEAD_REF"
```

If it is missing, the entrypoint selects the first existing branch from:

```bash
refs/heads/main refs/heads/master refs/heads
```

Then it repairs `HEAD` via:

```bash
git --git-dir "$CACHE_REPO_DIR" symbolic-ref HEAD "$CACHE_HEAD_REF"
```

The cache is used as clone source only if this succeeds.

### P1: Cache Use After Auth/Refresh Failure

Risk:

Using a warm mirror after `git fetch` fails can bypass private repo access checks and return stale data.

Resolution:

`CLONE_SOURCE_REPO_URL="$CACHE_REPO_DIR"` is assigned only inside the successful mirror refresh branch. On refresh failure, the clone source remains `CLONE_SOURCE_REPO_URL="$AUTH_REPO_URL"`.

## Regression Coverage

`packages/lib/tests/core/templates.test.ts` asserts:

- mirror refresh uses branch/tag-only refspecs;
- clone source defaults to `$AUTH_REPO_URL`;
- `$CACHE_REPO_DIR` becomes clone source only in the successful fetch path;
- mirror `HEAD` is checked and repaired before use;
- `--reference-if-able` is not used by the warm-cache path.

