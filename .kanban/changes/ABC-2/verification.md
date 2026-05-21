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

The stock e2e script was attempted:

```bash
bun run e2e:clone-cache
```

Environment finding:

- With `DOCKER_HOST=tcp://host.docker.internal:2375`, host CLI requires `DOCKER_GIT_API_URL`.
- With `DOCKER_HOST` unset, Docker is not accessible in this container.
- With `DOCKER_GIT_API_URL=http://host.docker.internal:3334`, the stock harness reaches clone setup but its helper expects local project directories while the API controller stores projects in controller state.

Manual warm-cache verification was then run against the reachable controller:

```bash
DOCKER_GIT_API_URL=http://host.docker.internal:3334 \
  bun packages/app/dist/src/docker-git/main.js clone \
  https://github.com/octocat/Hello-World/issues/1 \
  --force --gh-skip --no-ssh \
  --container-name <temporary-name> \
  --service-name <temporary-name> \
  --volume-name <temporary-name>-home
```

Assertions passed:

- container log contained `[clone-cache] using mirror:`;
- checkout branch was `issue-1`;
- `git rev-parse HEAD` returned a commit;
- container log did not contain `remote HEAD refers to nonexistent ref`.

Temporary verification containers were removed after the check.

## Current Workspace State

At archive time:

- working tree was clean before creating this audit trail;
- final code commits were present on branch `vk/2562-github-138`;
- archive artifacts are stored under `.kanban/changes/ABC-2`.

