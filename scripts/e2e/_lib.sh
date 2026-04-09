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
exec sudo -n docker "$@"
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
