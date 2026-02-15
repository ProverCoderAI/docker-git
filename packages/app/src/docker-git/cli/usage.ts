import { Match } from "effect"

import type { ParseError } from "@effect-template/lib/core/domain"

export const usageText = `docker-git menu
docker-git create --repo-url <url> [options]
docker-git clone <url> [options]
docker-git attach [<url>] [options]
docker-git panes [<url>] [options]
docker-git scrap <action> [<url>] [options]
docker-git sessions [list] [<url>] [options]
docker-git sessions kill <pid> [<url>] [options]
docker-git sessions logs <pid> [<url>] [options]
docker-git ps
docker-git down-all
docker-git auth <provider> <action> [options]
docker-git state <action> [options]

Commands:
  menu                Interactive menu (default when no args)
  create, init        Generate docker development environment
  clone               Create + run container and clone repo
  attach, tmux        Open tmux workspace for a docker-git project
  panes, terms        List tmux panes for a docker-git project
  scrap               Export/import project scrap (session snapshot + rebuildable deps)
  sessions            List/kill/log container terminal processes
  ps, status          Show docker compose status for all docker-git projects
  down-all            Stop all docker-git containers (docker compose down)
  auth                Manage GitHub/Codex auth for docker-git
  state               Manage docker-git state directory via git (sync across machines)

Options:
  --repo-ref <ref>          Git ref/branch (default: main)
  --branch, -b <ref>        Alias for --repo-ref
  --target-dir <path>       Target dir inside container (create default: /home/dev/app, clone default: /home/dev/<org>/<repo>[/issue-<id>|/pr-<id>])
  --ssh-port <port>         Local SSH port (default: 2222)
  --ssh-user <user>         SSH user inside container (default: dev)
  --container-name <name>   Docker container name (default: dg-<repo>)
  --service-name <name>     Compose service name (default: dg-<repo>)
  --volume-name <name>      Docker volume name (default: dg-<repo>-home)
  --secrets-root <path>     Host root for shared secrets (default: n/a)
  --authorized-keys <path>  Host path to authorized_keys (default: <projectsRoot>/authorized_keys)
  --env-global <path>       Host path to shared env file (default: <projectsRoot>/.orch/env/global.env)
  --env-project <path>      Host path to project env file (default: ./.orch/env/project.env)
  --codex-auth <path>       Host path for Codex auth cache (default: <projectsRoot>/.orch/auth/codex)
  --codex-home <path>       Container path for Codex auth (default: /home/dev/.codex)
  --out-dir <path>          Output directory (default: <projectsRoot>/<org>/<repo>[/issue-<id>|/pr-<id>])
  --project-dir <path>      Project directory for attach (default: .)
  --archive <path>          Scrap snapshot directory (default: .orch/scrap/session)
  --mode <session>          Scrap mode (default: session)
  --wipe | --no-wipe        Wipe workspace before scrap import (default: --wipe)
  --lines <n>               Tail last N lines for sessions logs (default: 200)
  --include-default         Show default/system processes in sessions list
  --up | --no-up            Run docker compose up after init (default: --up)
  --ssh | --no-ssh          Auto-open SSH after create/clone (default: clone=--ssh, create=--no-ssh)
  --mcp-playwright | --no-mcp-playwright  Enable Playwright MCP + Chromium sidecar (default: --no-mcp-playwright)
  --force                   Overwrite existing files and wipe compose volumes (docker compose down -v)
  --force-env               Reset project env defaults only (keep workspace volume/data)
  -h, --help                Show this help

Container runtime env (set via .orch/env/project.env):
  CODEX_SHARE_AUTH=1|0                  Share Codex auth.json across projects (default: 1)
  CODEX_AUTO_UPDATE=1|0                 Auto-update Codex CLI on container start (default: 1)
  DOCKER_GIT_ZSH_AUTOSUGGEST=1|0        Enable zsh-autosuggestions (default: 1)
  DOCKER_GIT_ZSH_AUTOSUGGEST_STYLE=...  zsh-autosuggestions highlight style (default: fg=8,italic)
  DOCKER_GIT_ZSH_AUTOSUGGEST_STRATEGY=...  Suggestion sources (default: history completion)
  MCP_PLAYWRIGHT_ISOLATED=1|0           Isolated browser contexts (recommended for many Codex; default: 1)
  MCP_PLAYWRIGHT_CDP_ENDPOINT=http://...  Override CDP endpoint (default: http://dg-<repo>-browser:9223)

Auth providers:
  github, gh         GitHub CLI auth (tokens saved to env file)
  codex             Codex CLI auth (stored under .orch/auth/codex)

Auth actions:
  login             Run login flow and store credentials
  status            Show current auth status
  logout            Remove stored credentials

Auth options:
  --label <label>        Account label (default: default)
  --token <token>        GitHub token override (login only)
  --scopes <scopes>      GitHub scopes (login only, default: repo,workflow,read:org)
  --env-global <path>    Env file path for GitHub tokens (default: <projectsRoot>/.orch/env/global.env)
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

// CHANGE: normalize parse errors into user-facing messages
// WHY: keep formatting deterministic and centralized
// QUOTE(ТЗ): "Надо написать CLI команду"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall e: format(e) = s -> deterministic(s)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: each ParseError maps to exactly one message
// COMPLEXITY: O(1)
export const formatParseError = (error: ParseError): string =>
  Match.value(error).pipe(
    Match.when({ _tag: "UnknownCommand" }, ({ command }) => `Unknown command: ${command}`),
    Match.when({ _tag: "UnknownOption" }, ({ option }) => `Unknown option: ${option}`),
    Match.when({ _tag: "MissingOptionValue" }, ({ option }) => `Missing value for option: ${option}`),
    Match.when({ _tag: "MissingRequiredOption" }, ({ option }) => `Missing required option: ${option}`),
    Match.when({ _tag: "InvalidOption" }, ({ option, reason }) => `Invalid option ${option}: ${reason}`),
    Match.when({ _tag: "UnexpectedArgument" }, ({ value }) => `Unexpected argument: ${value}`),
    Match.exhaustive
  )
