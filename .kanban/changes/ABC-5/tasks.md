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

- Should the final implementation use only the existing bare mirror cache, or introduce a separate working-copy cache to match the literal "git pull" wording?
- Should concurrent clone cache refreshes use a lock file in the shared cache volume?
- Should failed cache refresh be a warning with fallback or a hard clone failure?
