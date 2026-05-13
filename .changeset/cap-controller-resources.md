---
"@prover-coder-ai/docker-git": patch
---

feat: cap controller container CPU, memory, and PID consumption

Adds default `cpus`, `mem_limit`, `memswap_limit`, and `pids_limit` to the
`docker-git-api` controller in `docker-compose.yml` and
`docker-compose.api.yml`. Each value is parameterized so operators can
override it via `DOCKER_GIT_CONTROLLER_CPUS`, `DOCKER_GIT_CONTROLLER_MEMORY`,
and `DOCKER_GIT_CONTROLLER_PIDS`, or via `--controller-cpu`,
`--controller-ram`, and `--controller-pids` on the host CLI. Defaults resolve
to 90% CPU, 90% RAM/swap, and 4096 PIDs. This complements the existing
per-project caps so a runaway controller cannot consume the entire host.
