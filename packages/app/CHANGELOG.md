# @prover-coder-ai/docker-git

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
