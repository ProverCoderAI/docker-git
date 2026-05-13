#!/usr/bin/env bash
# CHANGE: control the API-first docker-git controller container from the host
# WHY: host should only need Docker while all orchestration runs inside the API controller
# QUOTE(TZ): "Поднимается сервер и ты через него можешь общаться с контейнером"
# REF: user-request-2026-03-15-api-controller
# SOURCE: n/a
# FORMAT THEOREM: forall cmd: valid(cmd) -> controller_action(cmd) terminates
# PURITY: SHELL
# EFFECT: Effect<IO, Error, Env>
# INVARIANT: every API request is executed from inside the controller container; host does not need curl or a package manager
# COMPLEXITY: O(1) + network/docker
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.yml"
CONTAINER_NAME="docker-git-api"
API_PORT="${DOCKER_GIT_API_PORT:-3334}"
API_HOST="${DOCKER_GIT_API_BIND_HOST:-127.0.0.1}"
API_BASE_URL="http://127.0.0.1:${API_PORT}"
DOCKER_CMD=()
PARSED_ARGS=()
CONTROLLER_CPU_LIMIT="${DOCKER_GIT_CONTROLLER_CPUS:-}"
CONTROLLER_RAM_LIMIT="${DOCKER_GIT_CONTROLLER_MEMORY:-}"
CONTROLLER_PIDS_LIMIT="${DOCKER_GIT_CONTROLLER_PIDS:-}"

usage() {
  cat <<'USAGE'
Usage: ./ctl <command> [controller options]

Controller:
  up              Build and start the API controller
  down            Stop and remove the API controller
  ps              Show controller status
  logs            Tail controller logs
  restart         Restart the controller
  shell           Open a shell inside the controller
  url             Print the published API URL
  health          GET /health through curl running inside the controller

API:
  projects        GET /projects
  request         request <METHOD> <PATH> [JSON_BODY]
                  examples:
                    ./ctl request GET /projects
                    ./ctl request POST /projects '{"repoUrl":"https://github.com/org/repo.git"}'
                    ./ctl request POST /projects/<projectId>/up

Controller options:
  --cpu, --cpus, --controller-cpu <value>       CPU cap intent, percent or cores (default: 90%)
  --ram, --memory, --controller-ram <value>     RAM cap intent, percent or size (default: 90%)
  --pids, --controller-pids <n>                 PID cap (default: 4096)

USAGE
}

compose() {
  "${DOCKER_CMD[@]}" compose -f "$COMPOSE_FILE" "$@"
}

compute_controller_revision() {
  bun --cwd "$ROOT/packages/app" scripts/print-controller-revision.ts "$COMPOSE_FILE"
}

prepare_controller_revision() {
  local revision
  revision="$(compute_controller_revision)"
  if [[ -z "$revision" ]]; then
    echo "Failed to compute controller revision." >&2
    exit 1
  fi
  export DOCKER_GIT_CONTROLLER_REV="$revision"
}

parse_controller_limit_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --cpu|--cpus|--controller-cpu|--controller-cpus)
        if [[ $# -lt 2 ]]; then
          echo "Missing value for option: $1" >&2
          exit 1
        fi
        CONTROLLER_CPU_LIMIT="$2"
        shift 2
        ;;
      --cpu=*|--cpus=*|--controller-cpu=*|--controller-cpus=*)
        CONTROLLER_CPU_LIMIT="${1#*=}"
        shift
        ;;
      --ram|--memory|--controller-ram|--controller-memory)
        if [[ $# -lt 2 ]]; then
          echo "Missing value for option: $1" >&2
          exit 1
        fi
        CONTROLLER_RAM_LIMIT="$2"
        shift 2
        ;;
      --ram=*|--memory=*|--controller-ram=*|--controller-memory=*)
        CONTROLLER_RAM_LIMIT="${1#*=}"
        shift
        ;;
      --pids|--controller-pids)
        if [[ $# -lt 2 ]]; then
          echo "Missing value for option: $1" >&2
          exit 1
        fi
        CONTROLLER_PIDS_LIMIT="$2"
        shift 2
        ;;
      --pids=*|--controller-pids=*)
        CONTROLLER_PIDS_LIMIT="${1#*=}"
        shift
        ;;
      *)
        PARSED_ARGS+=("$1")
        shift
        ;;
    esac
  done
}

prepare_controller_resource_limits() {
  local env_output
  env_output="$(
    DOCKER_GIT_CONTROLLER_CPUS="$CONTROLLER_CPU_LIMIT" \
    DOCKER_GIT_CONTROLLER_MEMORY="$CONTROLLER_RAM_LIMIT" \
    DOCKER_GIT_CONTROLLER_PIDS="$CONTROLLER_PIDS_LIMIT" \
      bun --cwd "$ROOT/packages/app" scripts/print-controller-resource-env.ts
  )"

  local key
  local value
  while IFS='=' read -r key value; do
    if [[ -z "$key" ]]; then
      continue
    fi
    case "$key" in
      DOCKER_GIT_CONTROLLER_CPUS|DOCKER_GIT_CONTROLLER_MEMORY|DOCKER_GIT_CONTROLLER_PIDS)
        export "$key=$value"
        ;;
    esac
  done <<< "$env_output"
}

require_running() {
  if ! "${DOCKER_CMD[@]}" ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    echo "Controller is not running. Start it with: ./ctl up" >&2
    exit 1
  fi
}

api_exec() {
  "${DOCKER_CMD[@]}" exec "$CONTAINER_NAME" "$@"
}

normalize_api_path() {
  local raw_path="$1"

  if [[ "$raw_path" != /projects/* ]]; then
    printf '%s' "$raw_path"
    return
  fi

  local normalized
  normalized="$("${DOCKER_CMD[@]}" exec -i "$CONTAINER_NAME" bun - "$raw_path" <<'NODE'
const raw = process.argv[2] ?? ""
const [pathname, query = ""] = raw.split(/\?(.*)/s, 2)
const prefix = "/projects/"

const joinWithQuery = (path) => query.length > 0 ? `${path}?${query}` : path
const encodeProjectPath = (projectId, suffix = "") =>
  joinWithQuery(`${prefix}${encodeURIComponent(projectId)}${suffix}`)

if (!pathname.startsWith(prefix)) {
  process.stdout.write(raw)
  process.exit(0)
}

const remainder = pathname.slice(prefix.length)
if (!remainder.startsWith("/")) {
  process.stdout.write(raw)
  process.exit(0)
}

const patterns = [
  {
    regex: /^(.*)\/agents\/([^/]+)\/(attach|stop|logs)$/u,
    render: ([, projectId, agentId, action]) =>
      encodeProjectPath(projectId, `/agents/${encodeURIComponent(agentId)}/${action}`)
  },
  {
    regex: /^(.*)\/agents\/([^/]+)$/u,
    render: ([, projectId, agentId]) =>
      encodeProjectPath(projectId, `/agents/${encodeURIComponent(agentId)}`)
  },
  {
    regex: /^(.*)\/agents$/u,
    render: ([, projectId]) => encodeProjectPath(projectId, "/agents")
  },
  {
    regex: /^(.*)\/(up|down|recreate|ps|logs|events)$/u,
    render: ([, projectId, action]) => encodeProjectPath(projectId, `/${action}`)
  },
  {
    regex: /^(.*)$/u,
    render: ([, projectId]) => encodeProjectPath(projectId)
  }
]

for (const { regex, render } of patterns) {
  const match = remainder.match(regex)
  if (match !== null) {
    process.stdout.write(render(match))
    process.exit(0)
  }
}

process.stdout.write(raw)
NODE
)"
  printf '%s' "$normalized"
}

api_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  require_running
  local normalized_path
  normalized_path="$(normalize_api_path "$path")"

  if [[ -n "$body" ]]; then
    printf '%s' "$body" | "${DOCKER_CMD[@]}" exec -i "$CONTAINER_NAME" sh -lc \
      "curl -fsS -X '$method' '$API_BASE_URL$normalized_path' -H 'content-type: application/json' --data-binary @-"
    printf '\n'
    return
  fi

  "${DOCKER_CMD[@]}" exec "$CONTAINER_NAME" sh -lc "curl -fsS -X '$method' '$API_BASE_URL$normalized_path'"
  printf '\n'
}

wait_for_health() {
  require_running
  local attempts=30
  local delay_seconds=2
  local attempt=1
  while (( attempt <= attempts )); do
    if "${DOCKER_CMD[@]}" exec "$CONTAINER_NAME" sh -lc "curl -fsS '$API_BASE_URL/health' >/dev/null"; then
      return 0
    fi
    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done

  echo "Controller did not become healthy in time." >&2
  return 1
}

resolve_docker_cmd() {
  if docker info >/dev/null 2>&1; then
    DOCKER_CMD=(docker)
    return
  fi
  if sudo -n docker info >/dev/null 2>&1; then
    DOCKER_CMD=(sudo docker)
    return
  fi
  DOCKER_CMD=(docker)
}

resolve_docker_cmd

parse_controller_limit_args "$@"
set -- "${PARSED_ARGS[@]}"

case "${1:-}" in
  up)
    prepare_controller_resource_limits
    prepare_controller_revision
    compose up -d --build
    wait_for_health
    echo "Controller API: http://${API_HOST}:${API_PORT}"
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
    prepare_controller_resource_limits
    prepare_controller_revision
    compose up -d --build --force-recreate
    wait_for_health
    ;;
  shell)
    require_running
    "${DOCKER_CMD[@]}" exec -it "$CONTAINER_NAME" bash
    ;;
  url)
    echo "http://${API_HOST}:${API_PORT}"
    ;;
  health)
    api_request GET /health
    ;;
  projects)
    api_request GET /projects
    ;;
  request)
    if [[ $# -lt 3 ]]; then
      echo "Usage: ./ctl request <METHOD> <PATH> [JSON_BODY]" >&2
      exit 1
    fi
    api_request "$2" "$3" "${4:-}"
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
