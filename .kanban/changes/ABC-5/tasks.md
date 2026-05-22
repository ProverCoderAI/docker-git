# ABC-5 Tasks

## Implementation

- [ ] Update `packages/lib/src/core/templates-entrypoint/tasks.ts` clone-cache flow.
- [ ] Apply the same template update to `packages/app/src/lib/core/templates-entrypoint/tasks.ts`.
- [ ] Keep cache roots under `/home/<sshUser>/.docker-git/.cache`.
- [ ] Preserve existing auth-label and token handling.
- [ ] Preserve existing fork remote behavior after clone.
- [ ] Preserve existing clone completion markers.
- [ ] Ensure cache paths are ignored by state repo sync if new cache directories are added.

## Tests

- [ ] Add or extend template tests for cache initialization, refresh, and reuse markers.
- [ ] Add or extend template tests for branch, issue branch, GitHub PR ref, and GitLab MR ref behavior.
- [ ] Extend `scripts/e2e/clone-cache.sh` to verify same repository cache reuse across two clones.
- [ ] Verify second clone uses cache and ends on the requested branch.
- [ ] Verify cache artifacts are not tracked by the state repository.

## Verification Commands

- [ ] `bun run --filter @effect-template/lib test`
- [ ] `bun run --filter @prover-coder-ai/docker-git test`
- [ ] `bun run typecheck`
- [ ] `bun run e2e:clone-cache`

## Out of Scope

- [ ] No CLI flag changes.
- [ ] No API contract changes.
- [ ] No state repo auto-pull changes.
- [ ] No merge to `main`.

## Open Questions

- Should the final implementation use only the existing bare mirror cache, or introduce a separate working-copy cache to match the literal "git pull" wording?
- Should concurrent clone cache refreshes use a lock file in the shared cache volume?
- Should failed cache refresh be a warning with fallback or a hard clone failure?
