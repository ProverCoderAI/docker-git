---
"@prover-coder-ai/docker-git": minor
"@effect-template/lib": minor
---

Add configurable CPU and RAM limits for the MCP Playwright sidecar container, separate from the main service container. Exposed via `--playwright-cpu`/`--playwright-cpus` and `--playwright-ram`/`--playwright-memory` CLI flags. Defaults to 30% of host resources, falling back to the main service limits when not set.
