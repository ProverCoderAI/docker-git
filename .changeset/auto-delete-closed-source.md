---
"@prover-coder-ai/docker-git": minor
---

Add opt-in automatic deletion of containers whose originating GitHub issue or pull request has been closed. Enable with `DOCKER_GIT_AUTO_DELETE_CLOSED=1` (scan interval configurable via `DOCKER_GIT_AUTO_DELETE_SCAN_INTERVAL_SECONDS`, default 300s). Deletion is conservative: it never runs for open/unknown source states, nor while an agent or live interactive session is active.
