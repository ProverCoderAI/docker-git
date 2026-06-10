---
"@prover-coder-ai/docker-git": minor
"@effect-template/api": minor
"@effect-template/lib": minor
---

feat(auth): add generic per-host git connections via token

Adds a new `git` auth provider so connections to git hosts other than
github.com/gitlab.com (Gitea, Bitbucket, self-hosted, ...) can be configured
by simply supplying a token, addressing issue #368.

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
