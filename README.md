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

# Same, but also enable Playwright MCP + Chromium sidecar for Codex
pnpm run docker-git clone https://github.com/agiens/crm/tree/vova-fork --force --mcp-playwright

# Experimental: generate project with Nix-based container flavor
pnpm run docker-git clone https://github.com/agiens/crm/tree/vova-fork --force --nix
```

## Container Base Flavor (Ubuntu/Nix)

By default, generated projects use an Ubuntu-based Dockerfile (`--base-flavor ubuntu`).

For migration experiments you can switch to Nix-based container setup:
- `--base-flavor nix`
- or shorthand `--nix`

This keeps the same docker-git workflow (SSH, compose, entrypoint logic), but installs toolchain packages via `nix profile install` instead of `apt`.

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
