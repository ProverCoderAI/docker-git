# @effect-template/lib

## 1.1.1

### Patch Changes

- [#398](https://github.com/ProverCoderAI/docker-git/pull/398) [`8a14af1`](https://github.com/ProverCoderAI/docker-git/commit/8a14af1dc1b2f1de881fff679edbc3117bc69b77) Thanks [@skulidropek](https://github.com/skulidropek)! - Connect the generated project containers to the new multi-agent plan-to-git build, install Claude Code plan hooks, and route queued agent plans through explicit PR-aware sync.

## 1.1.0

### Minor Changes

- [#264](https://github.com/ProverCoderAI/docker-git/pull/264) [`bda7e84`](https://github.com/ProverCoderAI/docker-git/commit/bda7e84f761c922557d1e286ccb0c39b8627b580) Thanks [@konard](https://github.com/konard)! - Add configurable CPU and RAM limits for the MCP Playwright sidecar container, separate from the main service container. Exposed via `--playwright-cpu`/`--playwright-cpus` and `--playwright-ram`/`--playwright-memory` CLI flags. Defaults to 30% of host resources, falling back to the main service limits when not set.
