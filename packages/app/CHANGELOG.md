# @prover-coder-ai/docker-git

## 1.3.10

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.66

## 1.3.9

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.65

## 1.3.8

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.64

## 1.3.7

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.63

## 1.3.6

### Patch Changes

- [#414](https://github.com/ProverCoderAI/docker-git/pull/414) [`2e66e2e`](https://github.com/ProverCoderAI/docker-git/commit/2e66e2e12e568f6dd9184b6a15e4ce619d56540a) Thanks [@konard](https://github.com/konard)! - Fix `docker-git clone` leaving the workspace `app` folder empty when `TARGET_DIR`
  is a tilde path.

  The generated entrypoint runs as `root` (sshd), so `$HOME` resolves to `/root`.
  When a `~`/`~/...` `TARGET_DIR` reached the entrypoint (e.g. via the `TARGET_DIR`
  env override), it was expanded against `$HOME`, resolving to `/root/app`. Because
  the auto-clone runs as `su - <sshUser>`, cloning into the root-owned `/root/app`
  failed with "permission denied", so the repository never landed in the prepared
  home and the workspace `app` folder stayed empty. The tilde is now expanded
  against the unprivileged user's home `/home/<sshUser>`, so the clone always lands
  in the dev-owned workspace.

## 1.3.5

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

## 1.3.4

### Patch Changes

- [#409](https://github.com/ProverCoderAI/docker-git/pull/409) [`b38ae32`](https://github.com/ProverCoderAI/docker-git/commit/b38ae32e3d473708057a10dd998295831eb73ee7) Thanks [@konard](https://github.com/konard)! - Fix the standalone base image cloning the repo outside the prepared `app` folder.

  The Dockerfile prepares and chowns `/home/dev/app` to the unprivileged `dev`
  user, but `entrypoint.sh` defaulted `TARGET_DIR` to `/work/app`. Because the
  auto-clone runs as `su - dev`, cloning into the root-created `/work/app` failed
  with permission denied, so the repository never landed in the `app` folder.
  The default now points at `/home/dev/app`, and the resolved `TARGET_DIR` is
  chowned to `dev` so overrides outside `/home/dev` keep working too.

## 1.3.3

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.62

## 1.3.2

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.61

## 1.3.1

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.60

## 1.3.0

### Minor Changes

- [#388](https://github.com/ProverCoderAI/docker-git/pull/388) [`6975aa9`](https://github.com/ProverCoderAI/docker-git/commit/6975aa94e1d201d0a0d480a1a1311b916af0ae3f) Thanks [@konard](https://github.com/konard)! - Add daemon mode for `docker-git browser` via `-d` and `--daemon`.

## 1.2.1

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.59

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

### Patch Changes

- [#386](https://github.com/ProverCoderAI/docker-git/pull/386) [`e6cd158`](https://github.com/ProverCoderAI/docker-git/commit/e6cd15842cb17214accfff7a3e3a879599221be6) Thanks [@konard](https://github.com/konard)! - Pin React and React DOM to the Gridland renderer-compatible 19.2.4 release so the CLI menu keeps a single valid React hook dispatcher.

## 1.1.56

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.58

## 1.1.55

### Patch Changes

- [#398](https://github.com/ProverCoderAI/docker-git/pull/398) [`8a14af1`](https://github.com/ProverCoderAI/docker-git/commit/8a14af1dc1b2f1de881fff679edbc3117bc69b77) Thanks [@skulidropek](https://github.com/skulidropek)! - Connect the generated project containers to the new multi-agent plan-to-git build, install Claude Code plan hooks, and route queued agent plans through explicit PR-aware sync.

## 1.1.54

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.57

## 1.1.53

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.56

## 1.1.52

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.55

## 1.1.51

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.54

## 1.1.50

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.53

## 1.1.49

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.52

## 1.1.48

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.51

## 1.1.47

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.50

## 1.1.46

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.49

## 1.1.45

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.48

## 1.1.44

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.47

## 1.1.43

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.46

## 1.1.42

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.45

## 1.1.41

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.44

## 1.1.40

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.43

## 1.1.39

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.42

## 1.1.38

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.41

## 1.1.37

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.40

## 1.1.36

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.39

## 1.1.35

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.38

## 1.1.34

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.37

## 1.1.33

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.36

## 1.1.32

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.35

## 1.1.31

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.34

## 1.1.30

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.33

## 1.1.29

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.32

## 1.1.28

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.31

## 1.1.27

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.30

## 1.1.26

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.29

## 1.1.25

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.28

## 1.1.24

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.27

## 1.1.23

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.26

## 1.1.22

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.25

## 1.1.21

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.24

## 1.1.20

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.23

## 1.1.19

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.22

## 1.1.18

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.21

## 1.1.17

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.20

## 1.1.16

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.19

## 1.1.15

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.18

## 1.1.14

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.17

## 1.1.13

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.16

## 1.1.12

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.15

## 1.1.11

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.14

## 1.1.10

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.13

## 1.1.9

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.12

## 1.1.8

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.11

## 1.1.7

### Patch Changes

- [#279](https://github.com/ProverCoderAI/docker-git/pull/279) [`2cf6fb4`](https://github.com/ProverCoderAI/docker-git/commit/2cf6fb421ee1df4f6aefcb17efb378e3adb14162) Thanks [@konard](https://github.com/konard)! - Add portable launch/build scripts and CI final-build verification across Linux, macOS, and Windows.

- Updated dependencies [[`2cf6fb4`](https://github.com/ProverCoderAI/docker-git/commit/2cf6fb421ee1df4f6aefcb17efb378e3adb14162)]:
  - @prover-coder-ai/docker-git-session-sync@1.0.10

## 1.1.6

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.9

## 1.1.5

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.8

## 1.1.4

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.7

## 1.1.3

### Patch Changes

- [#263](https://github.com/ProverCoderAI/docker-git/pull/263) [`f6682d3`](https://github.com/ProverCoderAI/docker-git/commit/f6682d36afa792206fc5bc9bcb63152b7c621d18) Thanks [@konard](https://github.com/konard)! - feat: cap controller container CPU, memory, and PID consumption

  Adds default `cpus`, `mem_limit`, `memswap_limit`, and `pids_limit` to the
  `docker-git-api` controller in `docker-compose.yml` and
  `docker-compose.api.yml`. Each value is parameterized so operators can
  override it via `DOCKER_GIT_CONTROLLER_CPUS`, `DOCKER_GIT_CONTROLLER_MEMORY`,
  and `DOCKER_GIT_CONTROLLER_PIDS`, or via `--controller-cpu`,
  `--controller-ram`, and `--controller-pids` on the host CLI. Defaults resolve
  to 90% CPU, 90% RAM/swap, and 4096 PIDs. This complements the existing
  per-project caps so a runaway controller cannot consume the entire host.

## 1.1.2

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.6

## 1.1.1

### Patch Changes

- [#270](https://github.com/ProverCoderAI/docker-git/pull/270) [`011e2e2`](https://github.com/ProverCoderAI/docker-git/commit/011e2e2687fae1a8afef7fba681282b4e3283430) Thanks [@konard](https://github.com/konard)! - Restore the SSH session toolbar after a page reload on `/ssh/session/:id`. The standalone terminal view now wires Open browser, Apply, Task manager, and New terminal handlers in addition to Detach and Kill, matching the dashboard-launched terminal toolbar.

## 1.1.0

### Minor Changes

- [#264](https://github.com/ProverCoderAI/docker-git/pull/264) [`bda7e84`](https://github.com/ProverCoderAI/docker-git/commit/bda7e84f761c922557d1e286ccb0c39b8627b580) Thanks [@konard](https://github.com/konard)! - Add configurable CPU and RAM limits for the MCP Playwright sidecar container, separate from the main service container. Exposed via `--playwright-cpu`/`--playwright-cpus` and `--playwright-ram`/`--playwright-memory` CLI flags. Defaults to 30% of host resources, falling back to the main service limits when not set.

## 1.0.87

### Patch Changes

- chore: automated version bump

## 1.0.86

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.5

## 1.0.85

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.4

## 1.0.84

### Patch Changes

- chore: automated version bump

- Updated dependencies []:
  - @prover-coder-ai/docker-git-session-sync@1.0.3

## 1.0.83

### Patch Changes

- Updated dependencies [[`c1e185a`](https://github.com/ProverCoderAI/docker-git/commit/c1e185a6c6ed669988a516d3ff7117e01021cf58)]:
  - @prover-coder-ai/docker-git-session-sync@1.0.2

## 1.0.82

### Patch Changes

- [#231](https://github.com/ProverCoderAI/docker-git/pull/231) [`babbf8d`](https://github.com/ProverCoderAI/docker-git/commit/babbf8db693d49c6e35996934658097dc305ba8b) Thanks [@skulidropek](https://github.com/skulidropek)! - Publish docker-git-session-sync as a public npm CLI and install it for post-push session backup comments, with a local Docker build fallback before first publish.

- Updated dependencies [[`babbf8d`](https://github.com/ProverCoderAI/docker-git/commit/babbf8db693d49c6e35996934658097dc305ba8b)]:
  - @prover-coder-ai/docker-git-session-sync@1.0.1

## 1.0.81

### Patch Changes

- chore: automated version bump

## 1.0.80

### Patch Changes

- chore: automated version bump

## 1.0.79

### Patch Changes

- chore: automated version bump

## 1.0.78

### Patch Changes

- chore: automated version bump

## 1.0.77

### Patch Changes

- chore: automated version bump

## 1.0.76

### Patch Changes

- chore: automated version bump

## 1.0.75

### Patch Changes

- chore: automated version bump

## 1.0.74

### Patch Changes

- chore: automated version bump

## 1.0.73

### Patch Changes

- chore: automated version bump

## 1.0.72

### Patch Changes

- chore: automated version bump

## 1.0.71

### Patch Changes

- chore: automated version bump

## 1.0.70

### Patch Changes

- chore: automated version bump

## 1.0.69

### Patch Changes

- chore: automated version bump

## 1.0.68

### Patch Changes

- chore: automated version bump

## 1.0.67

### Patch Changes

- chore: automated version bump

## 1.0.66

### Patch Changes

- chore: automated version bump

## 1.0.65

### Patch Changes

- chore: automated version bump

## 1.0.64

### Patch Changes

- chore: automated version bump

## 1.0.63

### Patch Changes

- chore: automated version bump

## 1.0.62

### Patch Changes

- chore: automated version bump

## 1.0.61

### Patch Changes

- chore: automated version bump

## 1.0.60

### Patch Changes

- chore: automated version bump

## 1.0.59

### Patch Changes

- chore: automated version bump

## 1.0.58

### Patch Changes

- chore: automated version bump

## 1.0.57

### Patch Changes

- chore: automated version bump

## 1.0.56

### Patch Changes

- chore: automated version bump

## 1.0.55

### Patch Changes

- chore: automated version bump

## 1.0.54

### Patch Changes

- chore: automated version bump

## 1.0.53

### Patch Changes

- chore: automated version bump

## 1.0.52

### Patch Changes

- chore: automated version bump

## 1.0.51

### Patch Changes

- chore: automated version bump

## 1.0.50

### Patch Changes

- chore: automated version bump

## 1.0.49

### Patch Changes

- chore: automated version bump

## 1.0.48

### Patch Changes

- chore: automated version bump

## 1.0.47

### Patch Changes

- chore: automated version bump

## 1.0.46

### Patch Changes

- chore: automated version bump

## 1.0.45

### Patch Changes

- chore: automated version bump

## 1.0.44

### Patch Changes

- chore: automated version bump

## 1.0.43

### Patch Changes

- chore: automated version bump

## 1.0.42

### Patch Changes

- chore: automated version bump

## 1.0.41

### Patch Changes

- chore: automated version bump

## 1.0.40

### Patch Changes

- chore: automated version bump

## 1.0.39

### Patch Changes

- chore: automated version bump

## 1.0.38

### Patch Changes

- chore: automated version bump

## 1.0.37

### Patch Changes

- chore: automated version bump

## 1.0.36

### Patch Changes

- chore: automated version bump

## 1.0.35

### Patch Changes

- chore: automated version bump

## 1.0.34

### Patch Changes

- chore: automated version bump

## 1.0.33

### Patch Changes

- chore: automated version bump

## 1.0.32

### Patch Changes

- chore: automated version bump

## 1.0.31

### Patch Changes

- chore: automated version bump

## 1.0.30

### Patch Changes

- chore: automated version bump

## 1.0.29

### Patch Changes

- chore: automated version bump

## 1.0.28

### Patch Changes

- chore: automated version bump

## 1.0.27

### Patch Changes

- chore: automated version bump

## 1.0.26

### Patch Changes

- chore: automated version bump

## 1.0.25

### Patch Changes

- chore: automated version bump

## 1.0.24

### Patch Changes

- chore: automated version bump

## 1.0.23

### Patch Changes

- chore: automated version bump

## 1.0.22

### Patch Changes

- chore: automated version bump

## 1.0.21

### Patch Changes

- chore: automated version bump

## 1.0.20

### Patch Changes

- chore: automated version bump

## 1.0.19

### Patch Changes

- chore: automated version bump

## 1.0.18

### Patch Changes

- chore: automated version bump

## 1.0.17

### Patch Changes

- chore: automated version bump

## 1.0.16

### Patch Changes

- chore: automated version bump

## 1.0.15

### Patch Changes

- chore: automated version bump

## 1.0.14

### Patch Changes

- chore: automated version bump

## 1.0.13

### Patch Changes

- chore: automated version bump

## 1.0.12

### Patch Changes

- chore: automated version bump

## 1.0.11

### Patch Changes

- chore: automated version bump

## 1.0.10

### Patch Changes

- chore: automated version bump

## 1.0.9

### Patch Changes

- chore: automated version bump

## 1.0.8

### Patch Changes

- chore: automated version bump

## 1.0.7

### Patch Changes

- chore: automated version bump

## 1.0.6

### Patch Changes

- chore: automated version bump

## 1.0.5

### Patch Changes

- chore: automated version bump

## 1.0.4

### Patch Changes

- chore: automated version bump

## 1.0.3

### Patch Changes

- chore: automated version bump

## 1.0.2

### Patch Changes

- chore: automated version bump

## 1.0.1

### Patch Changes

- chore: automated version bump
