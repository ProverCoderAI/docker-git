# ABC-2 Verification

## Passed Checks

The following checks were run in the workspace and passed:

```bash
bun run --cwd packages/lib test -- core/templates.test.ts
bun run --cwd packages/lib typecheck
bun run --cwd packages/app typecheck
bun run --cwd packages/app build:docker-git
bun run typecheck
bun run check
```

## Docker Runtime Verification

The stock clone-cache e2e script was run against the reachable docker-git
controller in this remote-Docker environment:

```bash
DOCKER_GIT_API_URL=http://172.18.0.3:3336 \
DOCKER_GIT_API_CONTAINER_NAME=docker-git-api-cloudflared \
DOCKER_GIT_E2E_CLONE_CACHE_TIMEOUT=900s \
  bash scripts/e2e/clone-cache.sh
```

Result:

```text
e2e/clone-cache: cache reuse verified for https://github.com/octocat/Hello-World/issues/1
```

Environment notes:

- `DOCKER_HOST=tcp://host.docker.internal:2375` requires an explicit `DOCKER_GIT_API_URL`.
- The controller container is named `docker-git-api-cloudflared`; setting `DOCKER_GIT_API_CONTAINER_NAME` lets the e2e helper inspect the nested project Docker daemon.
- A shorter `300s` first attempt expired while cold-pulling/building the base runtime image, before clone-cache assertions could run.

## Current Workspace State

At archive time:

- working tree was clean before creating this audit trail;
- final code commits were present on branch `vk/2562-github-138`;
- archive artifacts are stored under `.kanban/changes/ABC-2`.
