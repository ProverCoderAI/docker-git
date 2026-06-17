# @effect-template/lib

## 1.2.1

### Patch Changes

- [#416](https://github.com/ProverCoderAI/docker-git/pull/416) [`046a3dd`](https://github.com/ProverCoderAI/docker-git/commit/046a3ddde6a346bc5bfe927ff63bc25907b9def4) Thanks [@skulidropek](https://github.com/skulidropek)! - Separate the container definition from the panel and the backend (issue [#412](https://github.com/ProverCoderAI/docker-git/issues/412)).

  The container definition — the pure layer that renders a project's `Dockerfile`,
  `entrypoint.sh` and `docker-compose.yml` from a `TemplateConfig` — has been
  extracted from the backend package (`@effect-template/lib`) into a new,
  dependency-free leaf package `@prover-coder-ai/docker-git-container`. The backend
  now depends on it and re-exports the moved symbols, so its public API is
  unchanged.

  The panel (`@prover-coder-ai/docker-git`) no longer carries a duplicate copy of
  the container/backend logic: the dead `packages/app/src/lib` tree (165 files) and
  its now-unused `@lib` / `@effect-template/lib` aliases and dependency were
  removed. The `no-lib-imports` ESLint rule now forbids the panel from importing
  either the backend or the container-definition package, keeping the boundary
  enforced.

  No runtime behaviour changes: the generated container files are byte-identical
  (guaranteed by the unchanged property-based template test suite, which moved to
  the new package).

## 1.2.0

### Minor Changes

- [#393](https://github.com/ProverCoderAI/docker-git/pull/393) [`021f857`](https://github.com/ProverCoderAI/docker-git/commit/021f8577fa61b893f470a58e3846fb3e0aa89076) Thanks [@konard](https://github.com/konard)! - feat(auth): add generic per-host git connections via token

  Adds a new `git` auth provider so connections to git hosts other than
  github.com/gitlab.com (Gitea, Bitbucket, self-hosted, ...) can be configured
  by simply supplying a token, addressing issue [#368](https://github.com/ProverCoderAI/docker-git/issues/368).

  - CLI: `docker-git auth git login --host <host> --token <token> [--user <user>]`,
    `docker-git auth git status`, and `docker-git auth git logout --host <host>`.
    Tokens are persisted to the shared env file as host-scoped
    `GIT_AUTH_TOKEN__<HOST_KEY>` / `GIT_AUTH_USER__<HOST_KEY>` keys.
  - API: `GET /auth/git/status`, `POST /auth/git/login`, and `POST /auth/git/logout`.
    The status payload reports only the host and HTTPS username — token values
    are never returned.
  - Container: the in-container HTTPS credential helper now resolves per-host
    generic tokens first (matching the CLI/web host normalization: uppercase,
    non-alphanumeric → `_`, trimmed), then falls back to the github/gitlab
    defaults and the global `GIT_AUTH_TOKEN`. Host-scoped credentials are also
    exported to login and SSH shells so clone/push work outside the entrypoint.

  This also lets GitHub/GitLab connections be set up non-interactively by
  providing a token (`--token`) instead of running an OAuth web flow.

## 1.1.1

### Patch Changes

- [#398](https://github.com/ProverCoderAI/docker-git/pull/398) [`8a14af1`](https://github.com/ProverCoderAI/docker-git/commit/8a14af1dc1b2f1de881fff679edbc3117bc69b77) Thanks [@skulidropek](https://github.com/skulidropek)! - Connect the generated project containers to the new multi-agent plan-to-git build, install Claude Code plan hooks, and route queued agent plans through explicit PR-aware sync.

## 1.1.0

### Minor Changes

- [#264](https://github.com/ProverCoderAI/docker-git/pull/264) [`bda7e84`](https://github.com/ProverCoderAI/docker-git/commit/bda7e84f761c922557d1e286ccb0c39b8627b580) Thanks [@konard](https://github.com/konard)! - Add configurable CPU and RAM limits for the MCP Playwright sidecar container, separate from the main service container. Exposed via `--playwright-cpu`/`--playwright-cpus` and `--playwright-ram`/`--playwright-memory` CLI flags. Defaults to 30% of host resources, falling back to the main service limits when not set.
