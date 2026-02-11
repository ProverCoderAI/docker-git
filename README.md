# docker-git

`docker-git` generates a disposable Docker development environment per repository and stores it under a single projects root (default: `~/.docker-git`).

Key goals:
- Functional Core, Imperative Shell implementation (pure templates + typed orchestration).
- Per-project `.orch/` directory (env + local state), while still allowing shared credentials across containers.
- Optional Playwright MCP + Chromium sidecar so Codex can do browser automation.

## Quickstart

From this repo:

```bash
pnpm install

# Interactive TUI menu (default)
pnpm run docker-git

# Clone a repo into its own container (creates under ~/.docker-git)
pnpm run docker-git clone https://github.com/agiens/crm/tree/vova-fork --force

# Clone an issue URL (creates isolated workspace + issue branch)
pnpm run docker-git clone https://github.com/agiens/crm/issues/123 --force

# Reset only project env defaults (keep workspace volume/data)
pnpm run docker-git clone https://github.com/agiens/crm/issues/123 --force-env

# Same, but also enable Playwright MCP + Chromium sidecar for Codex
pnpm run docker-git clone https://github.com/agiens/crm/tree/vova-fork --force --mcp-playwright
```

## Parallel Issues / PRs

When you clone GitHub issue or PR URLs, docker-git creates isolated project paths and container names:
- `.../issues/123` -> `<projectsRoot>/<owner>/<repo>/issue-123` (branch `issue-123`)
- `.../pull/45` -> `<projectsRoot>/<owner>/<repo>/pr-45` (ref `refs/pull/45/head`)

This lets you run multiple issues/PRs for the same repository in parallel without container/path collisions.

Force modes:
- `--force`: overwrite managed files and wipe compose volumes (`docker compose down -v`).
- `--force-env`: reset only project env defaults and recreate containers without wiping volumes.

Agent context for issue workspaces:
- Global `${CODEX_HOME}/AGENTS.md` includes workspace path + issue/PR context.
- For `issue-*` workspaces, docker-git creates `${TARGET_DIR}/AGENTS.md` (if missing) with issue context and auto-adds it to `.git/info/exclude`.

## Projects Root Layout

The projects root is:
- `~/.docker-git` by default
- Override with `DOCKER_GIT_PROJECTS_ROOT=/some/path`

Structure (simplified):

```text
~/.docker-git/
  authorized_keys
  .orch/
    env/
      global.env
    auth/
      codex/          # shared Codex auth cache (credentials)
      gh/             # shared GitHub auth (optional)
  <owner>/<repo>/
    docker-compose.yml
    Dockerfile
    entrypoint.sh
    docker-git.json
    .orch/
      env/
        global.env    # copied/synced from root .orch/env/global.env
        project.env   # per-project env knobs (see below)
      auth/
        codex/        # project-local Codex state (sessions/logs/tmp/etc)
```

## Codex Auth: Shared Credentials, Per-Project Sessions

Default behavior:
- Shared credentials live in `/home/dev/.codex-shared/auth.json` (mounted from projects root).
- Each project keeps its own Codex state under `/home/dev/.codex/` (mounted from project `.orch/auth/codex`).
- The entrypoint links `/home/dev/.codex/auth.json -> /home/dev/.codex-shared/auth.json`.

This avoids `refresh_token` rotation issues that can happen when copying `auth.json` into every project while still keeping session state isolated per project.

Disable sharing (per-project auth):
- Set `CODEX_SHARE_AUTH=0` in `.orch/env/project.env`.

## Playwright MCP (Chromium Sidecar)

Enable during create/clone:
- Add `--mcp-playwright`

This will:
- Create a Chromium sidecar container: `dg-<repo>-browser`
- Configure Codex MCP server `playwright` inside the dev container
- Provide a wrapper `docker-git-playwright-mcp` inside the dev container

Concurrency (many Codex sessions):
- Default is safe for many sessions: `MCP_PLAYWRIGHT_ISOLATED=1`
- Each Codex session gets its own browser context (incognito) to reduce cross-session interference.
- If you want a shared browser context (shared cookies/login), set `MCP_PLAYWRIGHT_ISOLATED=0` (not recommended with multiple concurrent sessions).

## Runtime Env Knobs (per project)

Edit: `<projectDir>/.orch/env/project.env`

Common toggles:
- `CODEX_SHARE_AUTH=1|0` (default: `1`)
- `CODEX_AUTO_UPDATE=1|0` (default: `1`)
- `DOCKER_GIT_ZSH_AUTOSUGGEST=1|0` (default: `1`)
- `MCP_PLAYWRIGHT_ISOLATED=1|0` (default: `1`)
- `MCP_PLAYWRIGHT_CDP_ENDPOINT=http://...` (override CDP endpoint if needed)

## Troubleshooting

MCP errors in `codex` UI:
- `No such file or directory (os error 2)` for `playwright`:
  - `~/.codex/config.toml` contains `[mcp_servers.playwright]`, but the container was created without `--mcp-playwright`.
  - Fix: recreate with `--force --mcp-playwright` (or remove the block from `config.toml`).
- `handshaking ... initialize response`:
  - The configured MCP command is not a real MCP server (example: `command="echo"`).

## Security Notes

The generated Codex config uses:
- `sandbox_mode = "danger-full-access"`
- `approval_policy = "never"`

This is intended for local disposable containers. Do not reuse these defaults for untrusted code.
