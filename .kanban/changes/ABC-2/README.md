# ABC-2 Audit Trail

## Summary

ABC-2 implements repository clone caching for GitHub issue #138.

Requirement:

> "Что бы один и тот же репозиторий лежал бы в кеше и мы бы грузили данные из кеша + git pull под нужную нам ветку"

Final behavior:

- Project containers mount the shared cache volume at `/home/dev/.docker-git/.cache`.
- Repository cache mirrors are stored under `/home/dev/.docker-git/.cache/git-mirrors/<sha256(repoUrl)>.git`.
- Warm-cache clones use the refreshed bare mirror as the clone source.
- The mirror is used only after a successful authenticated refresh from the real remote.
- Before using a mirror as clone source, the generated entrypoint verifies and repairs bare mirror `HEAD` to an existing `refs/heads/*` ref.
- PR/MR refs still fetch the requested ref from the authenticated upstream URL after clone.

## Commits

- `1cb29d1 fix(core): clone repositories from warm mirror cache`
- `90b98a8 fix(core): guard warm mirror clone reuse`

## Changed Files

- `packages/lib/src/core/templates-entrypoint/tasks.ts`
- `packages/app/src/lib/core/templates-entrypoint/tasks.ts`
- `packages/lib/tests/core/templates.test.ts`

## Invariants

- `refresh_success(cache, remote) -> may_clone_from(cache)`
- `refresh_failure(cache, remote) -> clone_source = authenticated_remote`
- `may_clone_from(cache) -> exists(cache.HEAD) && cache.HEAD in refs/heads/*`
- `repoUrl equality -> same mirror key`
- `requested repoRef preserved in final working tree`

## Review Closure

The first implementation introduced two P1 risks:

- A mirror bootstrapped from an `issue-*` fallback could retain `HEAD` pointing to a local-only branch that later gets pruned.
- A private or stale mirror could be used after authenticated refresh failure, bypassing remote access checks.

Commit `90b98a8` closes both risks:

- Cache source assignment now lives only in the successful refresh branch.
- The mirror `HEAD` is validated with `show-ref` and repaired with `symbolic-ref` before use.

See `review.md` and `verification.md` for details.

