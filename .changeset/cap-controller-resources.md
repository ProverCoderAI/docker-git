---
"@prover-coder-ai/docker-git": patch
---

feat: cap controller container CPU, memory, and PID consumption

Adds default `cpus`, `mem_limit`, `memswap_limit`, and `pids_limit` to the
`docker-git-api` controller in `docker-compose.yml` and
`docker-compose.api.yml`. Each value is parameterized so operators can
override it via `DOCKER_GIT_CONTROLLER_CPUS`, `DOCKER_GIT_CONTROLLER_MEMORY`,
and `DOCKER_GIT_CONTROLLER_PIDS`. Defaults: 2 CPUs, 4 GiB RAM/swap, 4096 PIDs.
This complements the existing per-project caps so a runaway controller
cannot consume the entire host.
