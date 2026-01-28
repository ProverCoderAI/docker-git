#!/usr/bin/env bash
# CHANGE: provide a minimal local orchestrator for the dev container and auth helpers
# WHY: single command to manage the container and login flows
# QUOTE(TZ): "команда с помощью которой можно полностью контролировать этими докер образами"
# REF: user-request-2026-01-07
# SOURCE: n/a
# FORMAT THEOREM: forall cmd: valid(cmd) -> action(cmd) terminates
# PURITY: SHELL
# EFFECT: Effect<IO, Error, Env>
# INVARIANT: uses repo-local docker-compose.yml and dev-ssh container
# COMPLEXITY: O(1)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.yml"
CONTAINER_NAME="dev-ssh"
SSH_KEY="$ROOT/dev_ssh_key"
SSH_PORT="2222"
SSH_USER="dev"
SSH_HOST="localhost"

usage() {
  cat <<'USAGE'
Usage: ./ctl <command>

Container:
  up              Build and start the container
  down            Stop and remove the container
  ps              Show container status
  logs            Tail logs
  restart         Restart the container
  exec            Shell into the container
  ssh             SSH into the container

Codex auth:
  codex-login     Device-code login flow (headless-friendly)
  codex-status    Show auth status (exit 0 when logged in)
  codex-logout    Remove cached credentials

USAGE
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

case "${1:-}" in
  up)
    compose up -d --build
    ;;
  down)
    compose down
    ;;
  ps)
    compose ps
    ;;
  logs)
    compose logs -f --tail=200
    ;;
  restart)
    compose restart
    ;;
  exec)
    docker exec -it "$CONTAINER_NAME" bash
    ;;
  ssh)
    ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST"
    ;;
  codex-login)
    docker exec -it "$CONTAINER_NAME" codex login --device-auth
    ;;
  codex-status)
    docker exec "$CONTAINER_NAME" codex login status
    ;;
  codex-logout)
    docker exec -it "$CONTAINER_NAME" codex logout
    ;;
  help|--help|-h|"")
    usage
    ;;
  *)
    echo "Unknown command: $1" >&2
    usage >&2
    exit 1
    ;;
 esac
