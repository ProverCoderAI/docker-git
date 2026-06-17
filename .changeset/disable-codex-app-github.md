---
"@prover-coder-ai/docker-git": patch
---

Disable the unused `codex_app.github` connector in the managed Codex config.

The generated `config.toml` enables `apps`, which surfaces the built-in
`codex_app.github` connector. It is redundant inside docker-git because
containers already get GitHub access through the cloned repository, the synced
GitHub token, and the managed git wrapper, so the connector only adds noise.
The default Codex config now sets `[apps.github] enabled = false` (both the
`defaultCodexConfig` written by auth sync and the entrypoint heredoc), turning
the connector off while keeping the rest of the `apps` feature intact.
