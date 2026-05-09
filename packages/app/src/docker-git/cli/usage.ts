export { formatParseError } from "../frontend-lib/core/parse-errors.js"

export const usageText = `docker-git menu
docker-git browser
docker-git create [--repo-url <url>] [options]
docker-git clone <url> [options]
docker-git open [<selector>] [options]
docker-git apply [<url>] [options]
docker-git mcp-playwright [<url>] [options]
docker-git attach [<project-dir>] [options]
docker-git panes [<url>] [options]
docker-git scrap <action> [<url>] [options]
docker-git sessions [list] [<url>] [options]
docker-git sessions kill <pid> [<url>] [options]
docker-git sessions logs <pid> [<url>] [options]
docker-git ps
docker-git apply-all [--active]
docker-git down-all
docker-git auth <provider> <action> [options]
docker-git state <action> [options]

Commands:
  menu                Interactive menu (default when no args)
  browser             Build and serve the browser frontend for the docker-git controller
  create, init        Generate docker development environment (repo URL optional)
  clone               Create + run container and clone repo
  open                Open an existing docker-git project by selector, URL, or path
  apply               Apply docker-git config to an existing project/container (current dir by default)
  mcp-playwright      Enable Playwright MCP + Chromium sidecar for an existing project dir
  attach, tmux        Attach to an existing docker-git project workspace with tmux
  panes, terms        List tmux panes for a docker-git project
  scrap               Export/import project scrap (session snapshot + rebuildable deps)
  sessions            List/kill/log container terminal processes
  ps, status          Show docker compose status for all docker-git projects
  apply-all           Apply docker-git config and refresh all containers (docker compose up); use --active to restrict to running containers only
  down-all            Stop all docker-git containers (docker compose down)
  auth                Manage GitHub/GitLab/Codex/Claude Code auth for docker-git
  state               Manage docker-git state directory via git (sync across machines)

Options:
  --repo-url <url>          Repository URL (create: optional; clone: required via positional arg or flag)
  --repo-ref <ref>          Git ref/branch (default: main)
  --branch, -b <ref>        Alias for --repo-ref
  --target-dir <path>       Target dir inside container (create default: /home/dev/app, clone default: ~/workspaces/<org>/<repo>[/issue-<id>|/pr-<id>])
  --ssh-port <port>         Local SSH port (default: 2222)
  --ssh-user <user>         SSH user inside container (default: dev)
  --container-name <name>   Docker container name (default: dg-<repo>)
  --service-name <name>     Compose service name (default: dg-<repo>)
  --volume-name <name>      Docker volume name (default: dg-<repo>-home)
  --authorized-keys <path>  Host path to authorized_keys (default: <projectsRoot>/authorized_keys)
  --env-global <path>       Host path to shared env file (default: <projectsRoot>/.orch/env/global.env)
  --env-project <path>      Host path to project env file (default: ./.orch/env/project.env)
  --codex-auth <path>       Host path for Codex auth cache (default: <projectsRoot>/.orch/auth/codex)
  --codex-home <path>       Container path for Codex auth (default: /home/dev/.codex)
  --cpu <value>             CPU limit: percent or cores (examples: 30%, 1.5; default: 30%)
  --ram <value>             RAM limit: percent or size (examples: 30%, 512m, 4g; default: 30%)
  --network-mode <mode>     Compose network mode: shared|project (default: shared)
  --shared-network <name>   Shared Docker network name when network-mode=shared (default: docker-git-shared)
  --out-dir <path>          Output directory (default: <projectsRoot>/<org>/<repo>[/issue-<id>|/pr-<id>])
  --project-dir <path>      Project directory for open/attach (default: .)
  --archive <path>          Scrap snapshot directory (default: .orch/scrap/session)
  --mode <session>          Scrap mode (default: session)
  --git-token <label>       Token label for clone/create (maps to GITHUB_TOKEN__<LABEL>, GITLAB_TOKEN__<LABEL>, or GIT_AUTH_TOKEN__<LABEL>, example: agiens)
  --gh-skip                 Skip GitHub auth for public clone/create and force anonymous HTTPS clone
  --codex-token <label>     Codex auth label for clone/create (maps to CODEX_AUTH_LABEL, example: agien)
  --claude-token <label>    Claude auth label for clone/create (maps to CLAUDE_AUTH_LABEL, example: agien)
  --wipe | --no-wipe        Wipe workspace before scrap import (default: --wipe)
  --lines <n>               Tail last N lines for sessions logs (default: 200)
  --include-default         Show default/system processes in sessions list
  --up | --no-up            Run docker compose up after init (default: --up)
  --ssh | --no-ssh          Auto-open SSH after create/clone (default: clone=--ssh, create=--no-ssh)
  --mcp-playwright | --no-mcp-playwright  Enable Playwright MCP + Chromium sidecar (default: --no-mcp-playwright)
  --auto[=claude|codex]     Auto-execute an agent; without value picks by auth, random if both are available
  --active                  apply-all: apply only to currently running containers (skip stopped ones)
  --force                   Overwrite existing files, replace conflicting docker-git projects/containers, and wipe compose volumes
  --force-env               Reset project env defaults only (keep workspace volume/data)
  -h, --help                Show this help

Container runtime env (set via .orch/env/project.env):
  CODEX_SHARE_AUTH=1|0                  Share Codex auth.json across projects (default: 1)
  CODEX_AUTO_UPDATE=1|0                 Auto-update Codex CLI on container start (default: 1)
  CLAUDE_AUTO_SYSTEM_PROMPT=1|0         Auto-attach docker-git managed system prompt to claude (default: 1)
  DOCKER_GIT_ZSH_AUTOSUGGEST=1|0        Enable zsh-autosuggestions (default: 0)
  DOCKER_GIT_ZSH_AUTOSUGGEST_STYLE=...  zsh-autosuggestions highlight style (default: fg=8,italic)
  DOCKER_GIT_ZSH_AUTOSUGGEST_STRATEGY=...  Suggestion sources (default: history completion)
  MCP_PLAYWRIGHT_ISOLATED=1|0           Isolated browser contexts; default 0 shares the VNC session
  MCP_PLAYWRIGHT_CDP_GUARD=1|0          Guard CDP so MCP cannot close/crash shared Chromium (default: 1)
  MCP_PLAYWRIGHT_BLOCK_BROWSER_CLOSE=1|0  Block destructive Browser.close/crash CDP methods (default: 1)
  MCP_PLAYWRIGHT_CDP_ENDPOINT=http://...  Override CDP endpoint (default: http://dg-<repo>-browser:9223)
  MCP_PLAYWRIGHT_RETRY_ATTEMPTS=<n>     Retry attempts for browser sidecar startup wait (default: 10)
  MCP_PLAYWRIGHT_RETRY_DELAY=<seconds>  Delay between retry attempts (default: 2)

Auth providers:
  github, gh         GitHub CLI auth (tokens saved to env file)
  gitlab             GitLab CLI auth (tokens saved to env file)
  codex             Codex CLI auth (stored under .orch/auth/codex)
  claude, cc        Claude Code CLI auth (OAuth cache stored under .orch/auth/claude)

Auth actions:
  login             Run login flow and store credentials
  status            Show current auth status
  import            Import credentials from the configured auth directory
  logout            Remove stored credentials

Auth options:
  --label <label>        Account label (default: default)
  --token <token>        GitHub/GitLab token override (login only; useful for non-interactive/CI)
  --web                 Force OAuth web flow where supported (login only; ignores --token)
  --scopes <scopes>      GitHub scopes (login only, default: repo,workflow,read:org)
  --env-global <path>    Env file path for GitHub/GitLab tokens (default: <projectsRoot>/.orch/env/global.env)
  --codex-auth <path>    Codex auth root path (default: <projectsRoot>/.orch/auth/codex)

State actions:
  state path                         Print current projects root (default: ~/.docker-git; override via DOCKER_GIT_PROJECTS_ROOT)
  state init --repo-url <url> [-b]   Init / bind state dir to a git remote (use a private repo)
  state status                       Show git status for the state dir
  state pull                         git pull (state dir)
  state commit -m <message>          Commit all changes in the state dir
  state sync [-m <message>]          Commit (if needed) + fetch/rebase + push (state dir); on conflict pushes a PR branch
  state push                         git push (state dir)

State options:
  --message, -m <message>    Commit message for state commit
`
