# ABC-5 Design: Repository Download Cache

## Architecture Boundary

The change belongs in the generated container entrypoint clone shell, rendered by pure TypeScript template functions:

- Source template: `packages/lib/src/core/templates-entrypoint/tasks.ts`
- App mirror: `packages/app/src/lib/core/templates-entrypoint/tasks.ts`
- Compose cache mount: `packages/lib/src/core/templates/docker-compose.ts` and app mirror

The TypeScript layer remains pure template generation. Git, filesystem, and network operations remain in the generated shell inside the project container.

## Proposed Flow

1. Resolve `AUTH_REPO_URL` using the existing auth-label logic.
2. Resolve deterministic cache key from canonical `REPO_URL`.
3. Ensure cache root exists under `/home/<sshUser>/.docker-git/.cache`.
4. If a valid cache exists, refresh it before workspace preparation.
5. Prepare `TARGET_DIR` from cached data.
6. Checkout or create the branch requested by `REPO_REF`.
7. Set remotes using the existing fork/upstream logic.
8. Mark clone completion with the existing `/run/docker-git/clone.done` or `/run/docker-git/clone.failed` markers.

## Cache Shape

Use the existing bare mirror cache unless implementation proves a working-copy cache is required for the issue semantics. If a working-copy cache is introduced, keep it in a distinct path such as:

- `/home/<sshUser>/.docker-git/.cache/git-worktrees/<repo-cache-key>`

The bare mirror path remains:

- `/home/<sshUser>/.docker-git/.cache/git-mirrors/<repo-cache-key>.git`

## Invariants

- `forall repoUrl: cacheKey(repoUrl)` is deterministic and does not include tokens.
- `forall clone: cache refresh happens before target workspace checkout when a cache path exists`.
- `forall target: clone_ok(target) -> target/.git exists`.
- `forall target, repoRef: clone_ok(target, repoRef) -> target HEAD is repoRef-compatible`.
- `forall refreshedRefs: refreshedRefs subset refs/heads/* union refs/tags/*` for broad mirror refresh.
- `forall cache paths: cache path is under ~/.docker-git/.cache and ignored by state repo`.
- Authenticated URLs may be used for network commands, but tokenized URLs must not become cache keys or persisted remotes.

## Branch Handling

- Plain branch refs: checkout the requested branch from refreshed cache/remote.
- Issue refs such as `issue-138`: clone default branch, then create or reset local issue branch as existing behavior does.
- GitHub PR refs `refs/pull/<n>/head`: fetch the specific PR ref into deterministic local branch `pr-<n>`.
- GitLab MR refs `refs/merge-requests/<n>/head`: fetch the specific MR ref into deterministic local branch `mr-<n>`.
- Empty `REPO_REF`: use the remote default branch.

## Failure Behavior

- Invalid cache paths are removed or ignored and the flow falls back to network clone.
- Cache refresh failure should not corrupt an existing valid cache.
- If final workspace checkout fails, set `CLONE_OK=0` and write the existing failure marker.

## Risks

- Concurrent clones of the same repository may race while refreshing or creating cache paths.
- Working-copy caches need locking if added.
- `git pull` semantics differ for branch refs, issue branches, and PR/MR refs; implementation should prefer explicit `fetch` plus checkout/reset where that is more deterministic.

## Recommended Implementation Constraint

Prefer minimal changes to the existing bare mirror flow first. Treat "git pull под нужную нам ветку" as the externally visible invariant: cache is refreshed, then workspace is checked out to the requested branch. Add a working-copy cache only if e2e verification shows the bare mirror flow cannot satisfy the requirement.

## Final Design Decision

The implementation kept the existing bare mirror cache and did not introduce a separate working-copy cache. This preserved the established cache root and state-repo ignore contract while satisfying the branch-refresh invariant:

1. Refresh `/home/<sshUser>/.docker-git/.cache/git-mirrors/<repo-cache-key>.git` with branch/tag-only refspecs.
2. Clone warm-cache workspaces from that local mirror.
3. Restore `origin` to the authenticated repository URL before network fetch/pull.
4. Run `git pull --ff-only origin <repoRef>` for normal branch refs, or `git pull --ff-only` for no-ref default-branch clones.
5. Keep PR/MR refs on explicit fetch into deterministic local branches.
6. Keep issue refs as deterministic local branches after fallback clone.

No new cache directory was added, so the existing `.cache/git-mirrors/` ignore and untrack behavior remains sufficient.

## Archive Invariants

- Cache key remains derived from canonical `REPO_URL`, not `AUTH_REPO_URL`.
- Broad cache refresh remains limited to `refs/heads/*` and `refs/tags/*`.
- Tokenized auth URLs are used for network operations only; final remote normalization still runs through the existing fork/upstream remote block.
- Clone completion/failure markers remain `/run/docker-git/clone.done` and `/run/docker-git/clone.failed`.
- CLI/API contracts are unchanged.

## Archive Verification Notes

- The final implementation was rebased onto `origin/main`; implementation/archive baseline was pushed at `67ed16ec6b543492c80e1e5041bdbf55a934c81c`.
- Task-scope lint passed for both changed template files.
- Unit, package test, typecheck, and build verification passed locally.
- Full repository lint is not treated as an ABC-5 regression because the failing files are outside the ABC-5 diff: `packages/app/src/web/*` and `packages/app/src/docker-git/menu-create-shared.ts`.
- Local clone-cache e2e is environment-blocked by remote `DOCKER_HOST` controller discovery; the GitHub `E2E (Clone cache)` job is the authoritative remote e2e signal for this scenario.
