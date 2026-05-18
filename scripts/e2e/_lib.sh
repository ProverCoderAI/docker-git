#!/usr/bin/env bash
set -euo pipefail

# Shared helpers for docker-git E2E scripts (non-interactive).

dg_has_docker_access() {
  docker ps >/dev/null 2>&1
}

dg_has_sudo_docker_access() {
  sudo -n docker ps >/dev/null 2>&1
}

dg_install_docker_wrapper() {
  local bin_dir="$1"

  mkdir -p "$bin_dir"
  cat > "$bin_dir/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec sudo -n env \
  "COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-}" \
  "DOCKER_GIT_API_BIND_HOST=${DOCKER_GIT_API_BIND_HOST:-}" \
  "DOCKER_GIT_API_CONTAINER_NAME=${DOCKER_GIT_API_CONTAINER_NAME:-}" \
  "DOCKER_GIT_API_PORT=${DOCKER_GIT_API_PORT:-}" \
  "DOCKER_GIT_CONTROLLER_DOCKER_HOST=${DOCKER_GIT_CONTROLLER_DOCKER_HOST:-}" \
  "DOCKER_GIT_CONTROLLER_REV=${DOCKER_GIT_CONTROLLER_REV:-}" \
  "DOCKER_GIT_DOCKERD_DEFAULT_CGROUPNS_MODE=${DOCKER_GIT_DOCKERD_DEFAULT_CGROUPNS_MODE:-}" \
  "DOCKER_GIT_DOCKERD_TCP_HOST=${DOCKER_GIT_DOCKERD_TCP_HOST:-}" \
  "DOCKER_GIT_DOCKER_DATA_VOLUME=${DOCKER_GIT_DOCKER_DATA_VOLUME:-}" \
  "DOCKER_GIT_DOCKER_RUNTIME=${DOCKER_GIT_DOCKER_RUNTIME:-}" \
  "DOCKER_GIT_EXCHANGE_AGENT_COMMAND=${DOCKER_GIT_EXCHANGE_AGENT_COMMAND:-}" \
  "DOCKER_GIT_EXCHANGE_AGENT_PROVIDER=${DOCKER_GIT_EXCHANGE_AGENT_PROVIDER:-}" \
  "DOCKER_GIT_EXCHANGE_AGENT_TIMEOUT_MS=${DOCKER_GIT_EXCHANGE_AGENT_TIMEOUT_MS:-}" \
  "DOCKER_GIT_EXCHANGE_PROJECT_REPO_URL=${DOCKER_GIT_EXCHANGE_PROJECT_REPO_URL:-}" \
  "DOCKER_GIT_EXCHANGE_TARGETS=${DOCKER_GIT_EXCHANGE_TARGETS:-}" \
  "DOCKER_GIT_FEDERATION_ACTOR=${DOCKER_GIT_FEDERATION_ACTOR:-}" \
  "DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN=${DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN:-}" \
  "DOCKER_GIT_OUTBOX_POLLING_INTERVAL_MS=${DOCKER_GIT_OUTBOX_POLLING_INTERVAL_MS:-}" \
  "DOCKER_GIT_PROJECTS_ROOT=${DOCKER_GIT_PROJECTS_ROOT:-}" \
  "DOCKER_GIT_PROJECTS_ROOT_VOLUME=${DOCKER_GIT_PROJECTS_ROOT_VOLUME:-}" \
  "DOCKER_GIT_PROJECT_DOCKER_HOST=${DOCKER_GIT_PROJECT_DOCKER_HOST:-}" \
  "DOCKER_GIT_PROJECT_SSH_BIND_HOST=${DOCKER_GIT_PROJECT_SSH_BIND_HOST:-}" \
  "UBUNTU_APT_MIRROR=${UBUNTU_APT_MIRROR:-}" \
  docker "$@"
EOF
  chmod +x "$bin_dir/docker"
}

# Write a file to the Docker daemon host filesystem (useful when the Docker
# daemon cannot see the caller's local filesystem paths, but bind mounts still
# need real file contents).
#
# Usage:
#   echo "data" | dg_write_docker_host_file "/abs/path/on/host/file" 600
dg_write_docker_host_file() {
  local host_path="$1"
  local mode="${2:-}"
  local host_uid
  local host_gid

  local host_dir
  local host_name
  host_dir="$(dirname "$host_path")"
  host_name="$(basename "$host_path")"
  host_uid="$(id -u)"
  host_gid="$(id -g)"

  if [[ -n "$mode" ]] && [[ ! "$mode" =~ ^[0-7]{3,4}$ ]]; then
    echo "e2e: invalid file mode: $mode" >&2
    return 1
  fi

  if [[ -n "$mode" ]]; then
    docker run --rm -i \
      -e HOST_UID="$host_uid" \
      -e HOST_GID="$host_gid" \
      -v "$host_dir":/mnt ubuntu:24.04 \
      bash -lc "cat > \"/mnt/$host_name\" && chmod \"$mode\" \"/mnt/$host_name\" && chown \"\$HOST_UID:\$HOST_GID\" \"/mnt/$host_name\""
    return 0
  fi

  docker run --rm -i \
    -e HOST_UID="$host_uid" \
    -e HOST_GID="$host_gid" \
    -v "$host_dir":/mnt ubuntu:24.04 \
    bash -lc "cat > \"/mnt/$host_name\" && chown \"\$HOST_UID:\$HOST_GID\" \"/mnt/$host_name\""
}

# Ensure the calling script can run `docker` (and therefore docker-git) in a
# non-interactive environment. If the current user lacks access to the docker
# socket, but `sudo -n docker` works, install a `docker` wrapper earlier in PATH.
dg_ensure_docker() {
  local bin_dir="$1"

  if dg_has_docker_access; then
    return 0
  fi

  if dg_has_sudo_docker_access; then
    dg_install_docker_wrapper "$bin_dir"
    export PATH="$bin_dir:$PATH"
    return 0
  fi

  echo "e2e: docker is not accessible (docker ps failed; sudo -n docker ps also failed)" >&2
  return 1
}

dg_ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    return 0
  fi

  echo "e2e: bun is not installed or not in PATH" >&2
  return 1
}

dg_ensure_node_gyp() {
  local bin_dir="$1"

  if command -v node-gyp >/dev/null 2>&1; then
    return 0
  fi

  local prefix="$bin_dir/node-gyp"
  local node_gyp_bin="$prefix/node_modules/.bin"

  if [[ ! -x "$node_gyp_bin/node-gyp" ]]; then
    mkdir -p "$prefix"
    npm install --prefix "$prefix" node-gyp >/dev/null
  fi

  export PATH="$node_gyp_bin:$PATH"
}

dg_pick_free_port() {
  local first_port="$1"
  local last_port="$2"
  local host="${3:-127.0.0.1}"

  if ! command -v node >/dev/null 2>&1; then
    echo "e2e: node is required to pick a free TCP port" >&2
    return 1
  fi

  node - "$first_port" "$last_port" "$host" <<'NODE'
const net = require("node:net")

const [firstRaw, lastRaw, host] = process.argv.slice(2)
const first = Number.parseInt(firstRaw, 10)
const last = Number.parseInt(lastRaw, 10)

if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last > 65535 || first > last) {
  console.error(`e2e: invalid port range: ${firstRaw}-${lastRaw}`)
  process.exit(1)
}

const canListen = (port) =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once("error", () => resolve(false))
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })

;(async () => {
  const count = last - first + 1
  const start = Math.floor(Math.random() * count)

  for (let offset = 0; offset < count; offset += 1) {
    const port = first + ((start + offset) % count)
    if (await canListen(port)) {
      console.log(port)
      return
    }
  }

  console.error(`e2e: no free TCP port on ${host} in range ${first}-${last}`)
  process.exit(1)
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
NODE
}

dg_require_free_port() {
  local first_port="$1"
  local last_port="$2"
  local label="${3:-TCP}"
  local port

  if ! port="$(dg_pick_free_port "$first_port" "$last_port")" || [[ -z "$port" ]]; then
    echo "e2e: failed to pick free ${label} port in range ${first_port}-${last_port}" >&2
    return 1
  fi

  printf '%s\n' "$port"
}

dg_controller_container_name() {
  printf '%s\n' "${DOCKER_GIT_API_CONTAINER_NAME:-docker-git-api}"
}

dg_has_project_docker_access() {
  local controller
  controller="$(dg_controller_container_name)"

  docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$controller" \
    && docker exec "$controller" docker info >/dev/null 2>&1
}

dg_docker_args_request_tty() {
  local skip_next=0
  local arg

  for arg in "$@"; do
    if [[ "$arg" == "exec" ]]; then
      continue
    fi

    if [[ "$skip_next" == "1" ]]; then
      skip_next=0
      continue
    fi

    case "$arg" in
      --)
        return 1
        ;;
      --tty)
        return 0
        ;;
      --user|--workdir|--env|--env-file|--detach-keys)
        skip_next=1
        ;;
      --user=*|--workdir=*|--env=*|--env-file=*|--detach-keys=*)
        ;;
      -u|-w|-e)
        skip_next=1
        ;;
      -*t*)
        return 0
        ;;
      -*)
        ;;
      *)
        return 1
        ;;
    esac
  done

  return 1
}

# Run Docker commands against the daemon that owns docker-git project
# containers. In isolated-controller mode this is the daemon inside
# docker-git-api; in legacy/local mode it falls back to the host daemon.
dg_project_docker() {
  local controller
  controller="$(dg_controller_container_name)"

  if dg_has_project_docker_access; then
    if [[ "${1:-}" == "exec" ]]; then
      local exec_flags=(-i)
      if [[ -t 0 && -t 1 ]] && dg_docker_args_request_tty "$@"; then
        exec_flags=(-it)
      fi
      docker exec "${exec_flags[@]}" "$controller" docker "$@"
      return
    fi

    docker exec "$controller" docker "$@"
    return
  fi

  docker "$@"
}

dg_project_compose() {
  local project_dir="$1"
  shift

  local controller
  controller="$(dg_controller_container_name)"

  if dg_has_project_docker_access; then
    docker exec "$controller" bash -lc 'cd "$1" && shift && exec docker compose "$@"' \
      bash "$project_dir" "$@"
    return
  fi

  (cd "$project_dir" && docker compose "$@")
}

dg_project_container_ip() {
  local container="$1"

  dg_project_docker inspect \
    --format '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}' \
    "$container" 2>/dev/null \
    | sed '/^$/d' \
    | head -n 1
}

dg_rewrite_ssh_args_for_project_container() {
  local container_ip="$1"
  local controller_key_path="$2"
  shift 2

  local replace_identity=0
  local replace_port=0
  local arg
  for arg in "$@"; do
    if [[ "$replace_identity" == "1" ]]; then
      printf '%s\0' "$controller_key_path"
      replace_identity=0
      continue
    fi

    if [[ "$replace_port" == "1" ]]; then
      printf '%s\0' "22"
      replace_port=0
      continue
    fi

    case "$arg" in
      -i)
        printf '%s\0' "-i"
        replace_identity=1
        ;;
      -p)
        printf '%s\0' "-p"
        replace_port=1
        ;;
      *@127.0.0.1|*@localhost)
        printf '%s\0' "${arg%@*}@$container_ip"
        ;;
      *)
        printf '%s\0' "$arg"
        ;;
    esac
  done
}

dg_find_ssh_identity_arg() {
  local previous=""
  local arg

  for arg in "$@"; do
    if [[ "$previous" == "-i" ]]; then
      printf '%s\n' "$arg"
      return 0
    fi
    previous="$arg"
  done

  return 1
}

dg_project_ssh_to_container() {
  local container="$1"
  local local_ssh_command="$2"
  shift 2

  if ! dg_has_project_docker_access; then
    "$local_ssh_command" "$@"
    return
  fi

  local controller
  controller="$(dg_controller_container_name)"

  local container_ip
  container_ip="$(dg_project_container_ip "$container")"
  if [[ -z "$container_ip" ]]; then
    return 255
  fi

  local identity_arg=""
  identity_arg="$(dg_find_ssh_identity_arg "$@" || true)"
  local controller_key_path="/tmp/docker-git-e2e-ssh-key-$$-$RANDOM"
  if [[ -n "$identity_arg" ]]; then
    docker exec -i "$controller" bash -lc 'umask 077; cat > "$1"' bash "$controller_key_path" \
      < "$identity_arg"
  fi

  local rewritten=()
  while IFS= read -r -d '' arg; do
    rewritten+=("$arg")
  done < <(dg_rewrite_ssh_args_for_project_container "$container_ip" "$controller_key_path" "$@")

  local exec_flags=(-i)
  if [[ -t 0 && -t 1 ]]; then
    exec_flags=(-it)
  fi

  local ssh_exit=0
  local controller_key_arg=""
  if [[ -n "$identity_arg" ]]; then
    controller_key_arg="$controller_key_path"
  fi

  if docker exec "${exec_flags[@]}" "$controller" bash -lc '
    key_path="$1"
    shift
    cleanup() {
      if [[ -n "$key_path" ]]; then
        rm -f "$key_path" >/dev/null 2>&1 || true
      fi
    }
    trap cleanup EXIT HUP INT TERM
    ssh "$@"
  ' bash "$controller_key_arg" "${rewritten[@]}"; then
    ssh_exit=0
  else
    ssh_exit=$?
  fi

  if [[ -n "$identity_arg" ]]; then
    docker exec "$controller" rm -f "$controller_key_path" >/dev/null 2>&1 || true
  fi

  return "$ssh_exit"
}

dg_prepare_bun_workspace() {
  local repo_root="$1"
  local bin_dir="$2"

  dg_ensure_bun
  dg_ensure_node_gyp "$bin_dir"

  (
    cd "$repo_root"
    bun install --no-save --silent
  )
}

dg_build_docker_git_cli() {
  local repo_root="$1"

  (
    cd "$repo_root"
    bun run --cwd packages/app build:docker-git
  )
}

dg_prepare_docker_git_cli() {
  local repo_root="$1"
  local bin_dir="$2"

  dg_prepare_bun_workspace "$repo_root" "$bin_dir"
  dg_build_docker_git_cli "$repo_root"
}

dg_run_docker_git() {
  local repo_root="$1"
  shift

  (
    cd "$repo_root"
    bun packages/app/dist/src/docker-git/main.js "$@"
  )
}
