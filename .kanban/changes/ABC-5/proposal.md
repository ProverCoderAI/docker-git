# ABC-5 Proposal: Repository Download Cache

## Summary

Implement repository download caching for `docker-git clone` so repeated clones of the same repository reuse shared cached git data and refresh that cache before preparing the requested workspace branch.

## Requirement

GitHub issue #138:

> Что бы один и тот же репозиторий лежал бы в кеше и мы бы грузили данные из кеша + git pull под нужную нам ветку

## Current State

- The clone flow is generated as shell from `packages/lib/src/core/templates-entrypoint/tasks.ts` and mirrored in `packages/app/src/lib/core/templates-entrypoint/tasks.ts`.
- A shared Docker volume already mounts `/home/dev/.docker-git/.cache` into project containers.
- Existing cache behavior stores a per-`REPO_URL` bare mirror under `/home/dev/.docker-git/.cache/git-mirrors`.
- Existing clone behavior uses `--reference-if-able` and `--dissociate`, then performs branch or PR/MR checkout logic in the target workspace.
- Existing behavior refreshes the bare mirror with `git fetch --prune`, but it does not provide a cached working repository that is updated via branch-aware pull before workspace preparation.

## Scope

- Add or refine clone-cache behavior inside the generated entrypoint clone task.
- Keep cache state inside the shared cache volume.
- Preserve existing parsing of `REPO_URL`, `REPO_REF`, issue URLs, PR refs, GitLab merge request refs, auth labels, and fork remotes.
- Keep state repository sync behavior separate from repository download caching.
- Extend tests around template rendering and clone-cache e2e behavior.

## Non-Goals

- Do not change CLI argument semantics.
- Do not merge work into `main`.
- Do not cache secrets or auth material in repository cache paths.
- Do not commit cache artifacts into the `.docker-git` state repository.
- Do not broaden mirror refresh to hosted forge PR/MR refs.

## Acceptance Criteria

- Repeated clones of the same `REPO_URL` use the same cache key/path.
- The cache is refreshed before it is used for a workspace.
- The resulting workspace is checked out to the requested `REPO_REF` or deterministic local issue/PR/MR branch.
- Cache paths remain ignored and untracked by state repository sync.
- Existing clone flows continue to work for normal branches, issue URLs, GitHub PR refs, GitLab MR refs, and no-ref clones.
- Tests document the cache reuse and branch-refresh contract.

## Archive Status

- Status: implemented
- Branch: `vk/d6b8-abc-5-github-138`
- Pull request: https://github.com/ProverCoderAI/docker-git/pull/343
- Implementation archive head before final audit refresh: `67ed16ec6b543492c80e1e5041bdbf55a934c81c`
- Spec commit after rebase: `7ed9450 docs(spec): add ABC-5 clone cache plan`
- Implementation commit after rebase: `55ffaa3 feat(clone): reuse repository cache for branch pulls`
- Archive baseline commit after rebase: `67ed16e docs(spec): archive ABC-5 clone cache work`
- Final behavior: warm-cache clones use the refreshed bare mirror as the local clone source, then restore the authenticated origin and run branch-aware `git pull --ff-only` for normal branch/default branch flows.
- E2E note: `bun run e2e:clone-cache` is updated but could not run in the local review environment because the host CLI cannot auto-discover the controller when `DOCKER_HOST=tcp://host.docker.internal:2375` and `DOCKER_GIT_API_URL` is unset.
- Remote CI note: GitHub `E2E (Clone cache)` was still pending at archive time; other remote build/type/test/e2e checks had passed except the repository-wide `Lint` job, which failed on unrelated pre-existing `max-lines` violations outside ABC-5 files.
