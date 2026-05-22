# ABC-5 Tasks

## Implementation

- [x] Update `packages/lib/src/core/templates-entrypoint/tasks.ts` clone-cache flow.
- [x] Apply the same template update to `packages/app/src/lib/core/templates-entrypoint/tasks.ts`.
- [x] Keep cache roots under `/home/<sshUser>/.docker-git/.cache`.
- [x] Preserve existing auth-label and token handling.
- [x] Preserve existing fork remote behavior after clone.
- [x] Preserve existing clone completion markers.
- [x] Ensure cache paths are ignored by state repo sync if new cache directories are added.

## Tests

- [x] Add or extend template tests for cache initialization, refresh, and reuse markers.
- [x] Add or extend template tests for branch, issue branch, GitHub PR ref, and GitLab MR ref behavior.
- [x] Extend `scripts/e2e/clone-cache.sh` to verify same repository cache reuse across two clones.
- [x] Verify second clone uses cache and ends on the requested branch.
- [x] Verify cache artifacts are not tracked by the state repository.

## Verification Commands

- [x] `bun run --filter @effect-template/lib test`
- [x] `bun run --filter @prover-coder-ai/docker-git test`
- [x] `bun run typecheck`
- [ ] `bun run e2e:clone-cache` (blocked locally: docker-git host CLI cannot auto-discover controller over remote `DOCKER_HOST=tcp://host.docker.internal:2375`)

## Out of Scope

- [ ] No CLI flag changes.
- [ ] No API contract changes.
- [ ] No state repo auto-pull changes.
- [ ] No merge to `main`.

## Open Questions

- Resolved: use the existing bare mirror cache; no separate working-copy cache was added.
- Deferred: concurrent clone cache refreshes still do not use a lock file.
- Preserved: failed cache refresh remains a warning/fallback behavior rather than a hard clone failure.

## Archive Verification

- [x] `bun run --filter @effect-template/lib test -- tests/core/templates.test.ts` (49 tests passed)
- [x] `bun run --filter @effect-template/lib test` (52 files, 271 tests passed)
- [x] `bun run --filter @prover-coder-ai/docker-git test` (77 files, 476 tests passed)
- [x] `bun run typecheck`
- [x] Scoped lint for `packages/app/src/lib/core/templates-entrypoint/tasks.ts` (0 errors)
- [x] Scoped lint for `packages/lib/src/core/templates-entrypoint/tasks.ts` (0 errors)
- [ ] `bun run lint` failed on unrelated existing `max-lines` and `max-lines-per-function` violations outside ABC-5 changed files.
- [x] `bun run build`
- [x] Local git repro for warm-cache branch path: bare mirror refresh, clone from mirror, restore origin, `git pull --ff-only origin <branch>`.
- [ ] `bun run e2e:clone-cache` blocked by local Docker/controller discovery: `DOCKER_HOST=tcp://host.docker.internal:2375` with no reachable `DOCKER_GIT_API_URL`.
- [ ] GitHub `E2E (Clone cache)` pending at archive time.

## Archive Result

- Completed branch: `vk/d6b8-abc-5-github-138`
- Pull request: https://github.com/ProverCoderAI/docker-git/pull/343
- Implementation/archive baseline head: `67ed16ec6b543492c80e1e5041bdbf55a934c81c`
- Spec commit: `7ed9450 docs(spec): add ABC-5 clone cache plan`
- Implementation commit: `55ffaa3 feat(clone): reuse repository cache for branch pulls`
- Archive baseline commit: `67ed16e docs(spec): archive ABC-5 clone cache work`
- Merge status: not merged to `main`.
