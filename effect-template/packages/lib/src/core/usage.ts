import { Match } from "effect"

import type { ParseError } from "./domain.js"

export const usageText = `docker-git menu
docker-git create --repo-url <url> [options]
docker-git clone <url> [options]
docker-git ps
docker-git auth <provider> <action> [options]

Commands:
  menu                Interactive menu (default when no args)
  create, init        Generate docker development environment
  clone               Create + run container and clone repo
  ps, status          Show docker compose status for all docker-git projects
  auth                Manage GitHub/Codex auth for docker-git

Options:
  --repo-ref <ref>          Git ref/branch (default: main)
  --branch, -b <ref>        Alias for --repo-ref
  --target-dir <path>       Target dir inside container (create default: /home/dev/app, clone default: /home/dev/<org>/<repo>)
  --ssh-port <port>         Local SSH port (default: 2222)
  --ssh-user <user>         SSH user inside container (default: dev)
  --container-name <name>   Docker container name (default: dg-<repo>)
  --service-name <name>     Compose service name (default: dg-<repo>)
  --volume-name <name>      Docker volume name (default: dg-<repo>-home)
  --secrets-root <path>     Host root for shared secrets (default: n/a)
  --authorized-keys <path>  Host path to authorized_keys (default: ./.docker-git/authorized_keys)
  --env-global <path>       Host path to shared env file (default: ./.docker-git/.orch/env/global.env)
  --env-project <path>      Host path to project env file (default: ./.orch/env/project.env)
  --codex-auth <path>       Host path for Codex auth cache (default: ./.docker-git/.orch/auth/codex)
  --codex-home <path>       Container path for Codex auth (default: /home/dev/.codex)
  --out-dir <path>          Output directory (default: .docker-git/<org>/<repo>)
  --up | --no-up            Run docker compose up after init (default: --up)
  --force                   Overwrite existing files
  -h, --help                Show this help

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
  --env-global <path>    Env file path for GitHub tokens (default: ./.docker-git/.orch/env/global.env)
  --codex-auth <path>    Codex auth root path (default: ./.docker-git/.orch/auth/codex)
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
